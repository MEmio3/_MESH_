/**
 * Relay Manager — uses node-turn (pure JS TURN server) in-process.
 *
 * No external binaries. No package managers. No platform-specific logic.
 * Works identically on Windows, macOS, and Linux.
 *
 * The full lifecycle lives here so the UI toggle is one call:
 *   start TURN → pick the advertised IP for the chosen scope → (global only:
 *   UPnP port-map) → register on the signaling server → heartbeat every 25s
 *   so the 60s server-side expiry never fires → deregister + unmap on stop.
 */

import { randomBytes } from 'crypto'
import * as db from './database'
import { detectLocalIps } from './signaling-host'
import { getCachedSignature, refreshNetworkSignature } from './network-scanner'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TurnServer = require('node-turn')

// nat-upnp has no bundled types; declare the minimal surface we use.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const natUpnp = require('nat-upnp') as {
  createClient: () => {
    portMapping: (
      opts: { public: number; private: number; ttl: number; protocol: 'udp' | 'tcp' },
      cb: (err: Error | null) => void
    ) => void
    portUnmapping: (
      opts: { public: number; protocol: 'udp' | 'tcp' },
      cb: (err: Error | null) => void
    ) => void
    close: () => void
  }
}

export interface RelayStatus {
  running: boolean
  port: number
  scope: 'isp-local' | 'global'
  connections: number
  credentials: { username: string; password: string } | null
  /** turn:<ip>:<port> other peers should dial — null until computed. */
  advertisedAddress: string | null
  /** Id assigned by the signaling server — null until registered. */
  relayId: string | null
  error: string | null
}

interface TurnServerInstance {
  start: () => void
  stop: () => void
}

const HEARTBEAT_INTERVAL_MS = 25_000 // server expires relays after 60s silence

let server: TurnServerInstance | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let registeredSignalingUrl: string | null = null
let currentStatus: RelayStatus = {
  running: false,
  port: 3478,
  scope: 'isp-local',
  connections: 0,
  credentials: null,
  advertisedAddress: null,
  relayId: null,
  error: null
}

function generatePassword(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Pick the IP other peers should use to reach this relay, based on scope.
 *
 *   isp-local — the carrier-side interface (10/8, 100.64/10) if present so
 *               friends on the same ISP can dial it; falls back to the home
 *               LAN address (192.168/16, 172.16/12), then any interface.
 *   global    — the public internet IP (via ipify), falling back to the
 *               router's WAN IP (UPnP), then to a local interface.
 *
 * This is explicit selection from the machine's real topology — the old code
 * never computed an address at all, so registration had nothing to publish.
 */
async function pickAdvertisedIp(scope: 'isp-local' | 'global'): Promise<string | null> {
  if (scope === 'global') {
    const sig = getCachedSignature() ?? await refreshNetworkSignature().catch(() => null)
    if (sig?.publicIp) return sig.publicIp
    if (sig?.routerWanIp) return sig.routerWanIp
  }
  const locals = detectLocalIps()
  if (scope === 'isp-local') {
    const isp = locals.find((l) => l.scope === 'isp')
    if (isp) return isp.address
  }
  const home = locals.find((l) => l.scope === 'home')
  if (home) return home.address
  return locals[0]?.address ?? null
}

/** Best-effort UPnP mapping so a global relay is reachable from outside. */
function mapPortUpnp(port: number, protocol: 'udp' | 'tcp'): Promise<boolean> {
  return new Promise((resolve) => {
    let client: ReturnType<typeof natUpnp.createClient> | null = null
    const timer = setTimeout(() => {
      try { client?.close() } catch { /* ignore */ }
      resolve(false)
    }, 4000)
    try {
      client = natUpnp.createClient()
      client.portMapping({ public: port, private: port, ttl: 3600, protocol }, (err) => {
        clearTimeout(timer)
        try { client?.close() } catch { /* ignore */ }
        resolve(!err)
      })
    } catch {
      clearTimeout(timer)
      resolve(false)
    }
  })
}

function unmapPortUpnp(port: number, protocol: 'udp' | 'tcp'): void {
  try {
    const client = natUpnp.createClient()
    client.portUnmapping({ public: port, protocol }, () => {
      try { client.close() } catch { /* ignore */ }
    })
  } catch { /* best-effort */ }
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function startHeartbeat(signalingUrl: string, relayId: string): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    postJson(`${signalingUrl.replace(/\/$/, '')}/heartbeat-relay`, {
      id: relayId,
      users: currentStatus.connections
    }).catch(() => { /* transient — the next beat retries */ })
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/**
 * Start the in-process TURN relay and (when a signaling URL is provided)
 * publish it so other peers can discover and use it.
 */
export async function startRelay(opts: {
  port?: number
  scope?: 'isp-local' | 'global'
  signalingUrl?: string
}): Promise<{
  success: boolean
  error?: string
  credentials?: { username: string; password: string }
  advertisedAddress?: string
  relayId?: string
}> {
  if (server) {
    return { success: false, error: 'Relay already running' }
  }

  const port = opts.port ?? 3478
  const scope = opts.scope ?? 'isp-local'
  const username = 'relay'
  const password = generatePassword()

  try {
    server = new TurnServer({
      listeningPort: port,
      authMech: 'long-term',
      credentials: { [username]: password },
      debugLevel: 'OFF',
      realm: 'mesh.relay'
    }) as TurnServerInstance

    server.start()

    currentStatus = {
      running: true,
      port,
      scope,
      connections: 0,
      credentials: { username, password },
      advertisedAddress: null,
      relayId: null,
      error: null
    }
  } catch (err) {
    server = null
    const error = err instanceof Error ? err.message : String(err)
    currentStatus.error = error
    currentStatus.running = false
    return { success: false, error }
  }

  // Reachability: compute the address peers should dial. TURN itself works
  // even if this fails — it just can't be advertised.
  const ip = await pickAdvertisedIp(scope)
  const advertisedAddress = ip ? `turn:${ip}:${port}` : null
  currentStatus.advertisedAddress = advertisedAddress

  if (scope === 'global') {
    // Open the door from outside. Best-effort — CGNAT or disabled UPnP means
    // this fails silently and the relay only serves the local network.
    await Promise.all([mapPortUpnp(port, 'udp'), mapPortUpnp(port, 'tcp')])
  }

  // Publish on the signaling server so peers can discover this relay.
  if (opts.signalingUrl && advertisedAddress) {
    const reg = await registerWithSignaling(opts.signalingUrl, advertisedAddress, scope)
    if (reg.success && reg.relayId) {
      currentStatus.relayId = reg.relayId
      registeredSignalingUrl = opts.signalingUrl
      startHeartbeat(opts.signalingUrl, reg.relayId)
    } else {
      // Not fatal: the relay still works for anyone who adds it manually.
      currentStatus.error = reg.error ? `Registration failed: ${reg.error}` : null
    }
  }

  return {
    success: true,
    credentials: { username, password },
    advertisedAddress: advertisedAddress ?? undefined,
    relayId: currentStatus.relayId ?? undefined
  }
}

/**
 * Stop the running relay: deregister, stop heartbeat, unmap ports, shut down.
 */
export function stopRelay(): { success: boolean } {
  stopHeartbeat()
  if (registeredSignalingUrl && currentStatus.relayId) {
    postJson(`${registeredSignalingUrl.replace(/\/$/, '')}/deregister-relay`, {
      id: currentStatus.relayId
    }).catch(() => { /* server expiry cleans up in 60s anyway */ })
    db.removeRelay(currentStatus.relayId)
  }
  if (currentStatus.scope === 'global') {
    unmapPortUpnp(currentStatus.port, 'udp')
    unmapPortUpnp(currentStatus.port, 'tcp')
  }
  if (server) {
    try {
      server.stop()
    } catch {
      // ignore
    }
    server = null
  }
  registeredSignalingUrl = null
  currentStatus = {
    ...currentStatus,
    running: false,
    connections: 0,
    credentials: null,
    advertisedAddress: null,
    relayId: null
  }
  return { success: true }
}

/**
 * Get current relay status.
 */
export function getRelayStatus(): RelayStatus {
  return { ...currentStatus }
}

/**
 * Register this relay with a MESH signaling server so peers can discover it.
 * The server generates and returns the id; credentials travel with the
 * registration so discovering peers can authenticate to the TURN server.
 */
export async function registerWithSignaling(
  signalingUrl: string,
  address: string,
  scope: 'isp-local' | 'global'
): Promise<{ success: boolean; relayId?: string; error?: string }> {
  try {
    const response = await postJson(`${signalingUrl.replace(/\/$/, '')}/register-relay`, {
      address,
      scope,
      credentials: currentStatus.credentials
    })
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }
    const data = (await response.json()) as { id?: string }
    if (!data.id) {
      return { success: false, error: 'Signaling server returned no relay id' }
    }

    db.addRelay({
      id: data.id,
      address,
      scope,
      latency: null,
      users: 0,
      isCustom: 0,
      username: currentStatus.credentials?.username ?? null,
      password: currentStatus.credentials?.password ?? null
    })

    return { success: true, relayId: data.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Fetch the live relay list from a signaling server (main process — no CORS).
 */
export async function fetchRemoteRelays(signalingUrl: string): Promise<Array<{
  id: string
  address: string
  scope: 'isp-local' | 'global'
  credentials: { username: string; password: string } | null
  users: number
}>> {
  try {
    const res = await fetch(`${signalingUrl.replace(/\/$/, '')}/get-relays`)
    if (!res.ok) return []
    const list = (await res.json()) as Array<{
      id: string
      address: string
      scope: 'isp-local' | 'global'
      credentials?: { username: string; password: string } | null
      users?: number
    }>
    if (!Array.isArray(list)) return []
    return list
      .filter((r) => r && typeof r.address === 'string')
      .map((r) => ({
        id: r.id,
        address: r.address,
        scope: r.scope === 'global' ? 'global' : 'isp-local',
        credentials: r.credentials ?? null,
        users: r.users ?? 0
      }))
  } catch {
    return []
  }
}

/**
 * Shutdown hook for app quit.
 */
export function shutdownRelay(): void {
  stopRelay()
}
