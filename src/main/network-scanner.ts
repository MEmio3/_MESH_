/**
 * Network Signature Scanner.
 *
 * Probes three layers of the local network topology so the UI can tell the
 * user exactly which address their friend should use:
 *
 *   Layer 1 — Local Machine IP     (os.networkInterfaces)
 *   Layer 2 — Router WAN IP        (UPnP query to the default gateway)
 *   Layer 3 — Public Internet IP   (ipify)
 *
 * CGNAT detection falls out naturally: if `routerWanIp` is in 10.x.x.x or
 * 100.64.0.0/10 and differs from `publicIp`, the router itself is behind a
 * carrier-grade NAT and port-forwarding on the user's router alone will not
 * make them reachable from the open internet.
 *
 * Every external probe has an explicit 3-second timeout and is wrapped in
 * try/catch. The app must not hang or crash if UPnP is disabled or the
 * machine is offline.
 */

import { networkInterfaces } from 'os'
import { ipcMain } from 'electron'

// `nat-upnp` has no bundled types; fall back to a minimal inline shape.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const natUpnp = require('nat-upnp') as {
  createClient: () => {
    externalIp: (cb: (err: Error | null, ip?: string) => void) => void
    close: () => void
  }
}

export interface NetworkSignature {
  localIp: string | null
  routerWanIp: string | null
  publicIp: string | null
  upnpEnabled: boolean
}

const PROBE_TIMEOUT_MS = 3000

function isIpv4(value: string): boolean {
  const parts = value.trim().split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

function isPublicIpv4(value: string | null): boolean {
  if (!value || !isIpv4(value)) return false
  const [a, b] = value.split('.').map(Number)
  if (a === 10 || a === 127 || a === 0) return false
  if (a === 192 && b === 168) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  return true
}

/** Run a promise with a hard timeout. Rejects with Error('timeout') on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

// ── Layer 1 ────────────────────────────────────────────────────────────────

/**
 * Best local IPv4 address on the machine — prefers real LAN ranges
 * (192.168/16, 10/8, 172.16/12) over anything else, so VPN and virtual
 * adapters (Hamachi, ZeroTier, VMware, WSL...) don't win just by being
 * enumerated first. "First non-internal interface" regularly returned a
 * virtual adapter's address, which no friend could ever reach.
 */
function getLocalIp(): string | null {
  const isLan = (addr: string): boolean => {
    const [a, b] = addr.split('.').map((n) => parseInt(n, 10))
    if (a === 192 && b === 168) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    return false
  }
  let fallback: string | null = null
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const net of list) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (isLan(net.address)) return net.address
      if (!fallback) fallback = net.address
    }
  }
  return fallback
}

function getPublicInterfaceIp(): string | null {
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal && isPublicIpv4(net.address)) return net.address
    }
  }
  return null
}

// ── Layer 2 ────────────────────────────────────────────────────────────────

/**
 * Ask the default gateway (via UPnP IGD) for its external IP.
 * Returns null if UPnP is disabled, absent, or slow to respond.
 */
function getRouterWanIp(): Promise<string | null> {
  return withTimeout(
    new Promise<string | null>((resolve) => {
      let client: ReturnType<typeof natUpnp.createClient> | null = null
      try {
        client = natUpnp.createClient()
      } catch {
        resolve(null)
        return
      }
      client.externalIp((err, ip) => {
        try { client?.close() } catch { /* ignore */ }
        if (err || !ip) {
          resolve(null)
          return
        }
        resolve(ip)
      })
    }),
    PROBE_TIMEOUT_MS
  ).catch(() => null)
}

// ── Layer 3 ────────────────────────────────────────────────────────────────

/**
 * Query ipify for the real internet-facing IP. Uses AbortController for the
 * timeout so the socket is torn down cleanly on expiry.
 */
async function getPublicIp(): Promise<string | null> {
  const query = async (url: string, json: boolean): Promise<string | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: json ? 'application/json' : 'text/plain' }
      })
      if (!res.ok) return null
      const candidate = json
        ? String(((await res.json()) as { ip?: string }).ip ?? '').trim()
        : (await res.text()).trim()
      return isPublicIpv4(candidate) ? candidate : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  // Either service may be filtered by an ISP or DNS provider. Query both and
  // use the first valid IPv4 result so one blocked endpoint does not force the
  // UI back to a misleading LAN-only invitation.
  const probes = await Promise.all([
    query('https://api.ipify.org?format=json', true),
    query('https://ifconfig.me/ip', false)
  ])
  return probes.find((value): value is string => Boolean(value)) ?? null
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Run all three probes in parallel and return the signature.
 *
 * `upnpEnabled` is `true` iff the UPnP query returned an address — a reliable
 * proxy for "the router exposed an IGD and answered us."
 */
export async function scanNetworkSignature(): Promise<NetworkSignature> {
  const localIp = getLocalIp()
  const directPublicIp = getPublicInterfaceIp()
  const [routerWanIp, detectedPublicIp] = await Promise.all([getRouterWanIp(), getPublicIp()])
  const publicIp = detectedPublicIp
    ?? (isPublicIpv4(routerWanIp) ? routerWanIp : null)
    ?? directPublicIp
  return {
    localIp,
    routerWanIp,
    publicIp,
    upnpEnabled: routerWanIp !== null
  }
}

// ── Cache + IPC ────────────────────────────────────────────────────────────

let cached: NetworkSignature | null = null
let inFlight: Promise<NetworkSignature> | null = null

/**
 * Return the most recently cached signature, kicking off a background scan
 * if none is cached yet. Callers that need a fresh scan should use `refresh`.
 */
export function getCachedSignature(): NetworkSignature | null {
  return cached
}

export async function refreshNetworkSignature(): Promise<NetworkSignature> {
  if (inFlight) return inFlight
  inFlight = scanNetworkSignature()
    .then((sig) => { cached = sig; return sig })
    .finally(() => { inFlight = null })
  return inFlight
}

export function registerNetworkScannerHandlers(): void {
  ipcMain.handle('network:scan', async () => {
    const sig = await refreshNetworkSignature()
    return { signature: sig, interpretation: interpretSignature(sig) }
  })
  ipcMain.handle('network:cached', () => {
    return cached
      ? { signature: cached, interpretation: interpretSignature(cached) }
      : null
  })
}

/**
 * Derive a plain-English reachability verdict from a signature.
 * Handy for the UI — "you need port forwarding," "you are behind CGNAT," etc.
 */
export function interpretSignature(sig: NetworkSignature): {
  behindCgnat: boolean
  directlyReachable: boolean
  explanation: string
} {
  const isCgnat = (ip: string | null): boolean => {
    if (!ip) return false
    const [a, b] = ip.split('.').map((n) => parseInt(n, 10))
    if (a === 10) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }

  const behindCgnat =
    sig.routerWanIp !== null &&
    sig.publicIp !== null &&
    (isCgnat(sig.routerWanIp) || sig.routerWanIp !== sig.publicIp)

  const directlyReachable =
    !behindCgnat && sig.publicIp !== null && sig.upnpEnabled

  let explanation: string
  if (behindCgnat) {
    explanation =
      'Your ISP uses Carrier-Grade NAT. Port-forwarding on your router alone will not expose the MESH host. Use a VPN/overlay network or run the host on a connection with a public IP.'
  } else if (!sig.publicIp) {
    explanation = 'Could not reach the internet. Only LAN connections are available right now.'
  } else if (!sig.upnpEnabled) {
    explanation =
      'Your router has a public IP but UPnP is disabled. Forward the selected MESH host port for both TCP and UDP before sharing an Internet invite.'
  } else {
    explanation =
      'Your router has a public IP and UPnP is available. Confirm the selected MESH host port is mapped for TCP and UDP before sharing an Internet invite.'
  }

  return { behindCgnat, directlyReachable, explanation }
}
