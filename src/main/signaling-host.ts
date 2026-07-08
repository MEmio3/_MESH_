/**
 * Host the signaling server inside the Electron main process (Fix 1 + 2).
 *
 * Thin wrapper around `src/server/signaling.ts` that exposes IPC for the
 * renderer's "Host Signaling Server" toggle and shows the local LAN IP so
 * the user can share it with friends.
 */

import { networkInterfaces } from 'os'
import { ipcMain } from 'electron'
import { createSignalingInstance, type SignalingInstance } from '../server/signaling'

// Every host port this machine is running, keyed by port. Multiple entries =
// multiple independent MESH networks hosted from one machine at once.
const hosts = new Map<number, SignalingInstance>()
let lastError: string | null = null
const inFlight = new Set<number>()

export type IpScope = 'home' | 'isp' | 'public'

export interface DetectedIp {
  address: string
  scope: IpScope
  label: string
  iface: string
}

/**
 * Classify an IPv4 address into one of three scopes using only the address
 * itself — no DNS, no STUN, no external services.
 *
 *   home   — RFC1918 LAN:   192.168/16, 172.16/12, 10/8
 *   isp    — carrier-grade: 100.64/10 (RFC6598)
 *   public — anything else non-internal
 *
 * 10/8 counts as HOME here: on a machine's own interface it is almost always
 * the router's LAN range (countless routers ship with 10.0.0.x defaults).
 * Carrier-grade NAT shows up on the ROUTER'S WAN address (network-scanner's
 * job), not on a local NIC. The old classification labelled 10.x as "ISP
 * Network", telling users to share a LAN-only/private address with friends
 * across town — a direct cause of "the app picks the wrong IP".
 */
function classify(addr: string): IpScope {
  const parts = addr.split('.').map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return 'public'
  const [a, b] = parts
  if (a === 192 && b === 168) return 'home'
  if (a === 172 && b >= 16 && b <= 31) return 'home'
  if (a === 10) return 'home'
  if (a === 100 && b >= 64 && b <= 127) return 'isp'
  return 'public'
}

const SCOPE_LABELS: Record<IpScope, string> = {
  home: 'Home WiFi — same router only',
  isp: 'ISP private address - not for sharing',
  public: 'Public IP - port 3000 must be open'
}

/**
 * Enumerate every non-internal IPv4 address on the machine and tag it with
 * a human-readable scope label. No guessing, no auto-pick — the UI shows
 * all of them and the user copies the one that matches their situation.
 */
export function detectLocalIps(): DetectedIp[] {
  const out: DetectedIp[] = []
  const seen = new Set<string>()
  const ifaces = networkInterfaces()
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue
    for (const net of list) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (seen.has(net.address)) continue
      seen.add(net.address)
      const scope = classify(net.address)
      out.push({ address: net.address, scope, label: SCOPE_LABELS[scope], iface: name })
    }
  }
  return out
}

const isRunningPort = (port: number): boolean => hosts.get(port)?.isRunning() ?? false

/** Start (or confirm) a host instance on `port`. Idempotent per port. */
export async function startHost(port: number): Promise<{ success: boolean; error?: string; port?: number }> {
  if (isRunningPort(port)) return { success: true, port }
  if (inFlight.has(port)) return { success: true, port }
  inFlight.add(port)
  try {
    lastError = null
    const instance = createSignalingInstance(port)
    await instance.start()
    hosts.set(port, instance)
    console.log('[signaling-host] hosting on port', port, '· total hosts:', hosts.size)
    return { success: true, port }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    // EADDRINUSE is the common one — surface a friendly reason.
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'EADDRINUSE') lastError = `Port ${port} is already in use.`
    console.error('[signaling-host] start failed on', port, ':', lastError)
    return { success: false, error: lastError }
  } finally {
    inFlight.delete(port)
  }
}

/** Stop one host port, or all of them when `port` is omitted. */
export async function stopHost(port?: number): Promise<{ success: boolean }> {
  const targets = port !== undefined ? [port] : [...hosts.keys()]
  for (const p of targets) {
    const instance = hosts.get(p)
    if (!instance) continue
    try {
      await instance.stop()
    } catch (err) {
      console.error('[signaling-host] stop failed on', p, ':', err)
    }
    hosts.delete(p)
  }
  return { success: true }
}

/** The primary host port = the one the local client connects through. We
 *  treat the lowest running port as primary for the single-host status view. */
function primaryPort(): number {
  const ports = [...hosts.keys()].filter((p) => isRunningPort(p)).sort((a, b) => a - b)
  return ports[0] ?? 0
}

export function listHostPorts(): number[] {
  return [...hosts.keys()].filter((p) => isRunningPort(p)).sort((a, b) => a - b)
}

// Back-compat wrappers for app boot / quit paths.
export async function startHosting(port = 3000): Promise<{ success: boolean; error?: string; port?: number }> {
  return startHost(port)
}
export async function stopHosting(): Promise<{ success: boolean }> {
  return stopHost()
}

export function registerSignalingHostHandlers(): void {
  ipcMain.handle('signaling-host:start', async (_e, payload?: { port?: number }) => {
    return startHost(payload?.port ?? 3000)
  })
  ipcMain.handle('signaling-host:stop', async (_e, payload?: { port?: number }) => {
    return stopHost(payload?.port)
  })
  ipcMain.handle('signaling-host:status', () => {
    const ports = listHostPorts()
    return {
      running: ports.length > 0,
      port: primaryPort(),
      ports,
      localIps: detectLocalIps(),
      error: lastError
    }
  })
  ipcMain.handle('signaling-host:list', () => listHostPorts())
}
