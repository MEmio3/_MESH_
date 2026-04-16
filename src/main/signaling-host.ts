/**
 * Host the signaling server inside the Electron main process (Fix 1 + 2).
 *
 * Thin wrapper around `src/server/signaling.ts` that exposes IPC for the
 * renderer's "Host Signaling Server" toggle and shows the local LAN IP so
 * the user can share it with friends.
 */

import { networkInterfaces } from 'os'
import { ipcMain } from 'electron'
import { startSignalingServer, stopSignalingServer, isSignalingRunning, getSignalingPort } from '../server/signaling'

let lastError: string | null = null
let isStarting = false
let isStopping = false

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
 *   home   — RFC1918 LAN:   192.168/16, 172.16/12
 *   isp    — carrier-grade: 10/8, 100.64/10
 *   public — anything else non-internal
 */
function classify(addr: string): IpScope {
  const parts = addr.split('.').map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return 'public'
  const [a, b] = parts
  if (a === 192 && b === 168) return 'home'
  if (a === 172 && b >= 16 && b <= 31) return 'home'
  if (a === 10) return 'isp'
  if (a === 100 && b >= 64 && b <= 127) return 'isp'
  return 'public'
}

const SCOPE_LABELS: Record<IpScope, string> = {
  home: 'Home WiFi — same router only',
  isp: 'ISP Network — friends on same ISP',
  public: 'Public IP — anyone can connect'
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

export async function startHosting(port = 3000): Promise<{ success: boolean; error?: string; port?: number }> {
  if (isStarting) {
    console.log('[signaling-host] start already in progress, ignoring duplicate call')
    return { success: true, port: getSignalingPort() }
  }
  if (isSignalingRunning()) {
    console.log('[signaling-host] already running on port', getSignalingPort())
    return { success: true, port: getSignalingPort() }
  }
  try {
    isStarting = true
    lastError = null
    const res = await startSignalingServer(port)
    console.log('[signaling-host] started successfully on port', res.port)
    return { success: true, port: res.port }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.error('[signaling-host] start failed:', lastError)
    return { success: false, error: lastError }
  } finally {
    isStarting = false
  }
}

export async function stopHosting(): Promise<{ success: boolean }> {
  if (isStopping) {
    console.log('[signaling-host] stop already in progress, ignoring duplicate call')
    return { success: true }
  }
  if (!isSignalingRunning()) {
    console.log('[signaling-host] not running, nothing to stop')
    return { success: true }
  }
  try {
    isStopping = true
    await stopSignalingServer()
    console.log('[signaling-host] stopped successfully')
    return { success: true }
  } catch (err) {
    console.error('[signaling-host] stop failed:', err)
    return { success: false }
  } finally {
    isStopping = false
  }
}

export function registerSignalingHostHandlers(): void {
  ipcMain.handle('signaling-host:start', async (_e, payload?: { port?: number }) => {
    return startHosting(payload?.port ?? 3000)
  })
  ipcMain.handle('signaling-host:stop', async () => {
    return stopHosting()
  })
  ipcMain.handle('signaling-host:status', () => {
    return {
      running: isSignalingRunning(),
      port: getSignalingPort(),
      localIps: detectLocalIps(),
      error: lastError
    }
  })
}
