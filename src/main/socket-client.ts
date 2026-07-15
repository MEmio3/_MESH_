import { io, Socket } from 'socket.io-client'
import { app, BrowserWindow } from 'electron'
import { getServer, getSetting } from './database'
import * as voiceUdp from './voice-udp-client'
import {
  MESH_MIN_PROTOCOL_VERSION,
  MESH_PROTOCOL_VERSION,
  type CompatibilityResponse,
  type CompatibilityStatus
} from '../shared/protocol'

let socket: Socket | null = null
let mainWindow: BrowserWindow | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let reconnectAttempts: number = 0
let currentUrl: string = ''
let currentUserId: string = ''
let isConnecting = false
let connectingPromise: Promise<void> | null = null
let hostHealthTimer: NodeJS.Timeout | null = null
const intentionalDisconnects = new WeakSet<Socket>()
const auxiliarySockets = new Map<string, Socket>()

export type HostConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline'
export type HostHealthQuality = 'checking' | 'healthy' | 'degraded' | 'unreachable'
export interface HostConnectionSnapshot {
  url: string
  role: 'primary' | 'secondary'
  state: HostConnectionState
  attempt: number
  retryAt: number | null
  lastConnectedAt: number | null
  lastDisconnectedAt: number | null
  reason: string | null
  error: string | null
  healthQuality: HostHealthQuality
  latencyMs: number | null
  jitterMs: number | null
  packetLossPct: number | null
  lastProbeAt: number | null
  lastHealthyAt: number | null
  consecutiveFailures: number
  transport: string | null
  compatibilityStatus: CompatibilityStatus
  localAppVersion: string
  remoteAppVersion: string | null
  remoteProtocolVersion: number | null
  remoteMinProtocolVersion: number | null
  compatibilityMessage: string | null
  lastCompatibilityCheckAt: number | null
}

const hostConnectionStates = new Map<string, HostConnectionSnapshot>()
const hostHealthSamples = new Map<string, Array<{ ok: boolean; latencyMs: number | null }>>()
const healthProbesInFlight = new Set<string>()

function publishHostStates(): void {
  sendToRenderer('signaling:host-statuses-changed', listHostConnectionStatuses())
}

function updateHostState(
  url: string,
  role: HostConnectionSnapshot['role'],
  patch: Partial<Omit<HostConnectionSnapshot, 'url' | 'role'>>
): void {
  const normalized = normalizeUrl(url)
  const previous = hostConnectionStates.get(normalized)
  hostConnectionStates.set(normalized, {
    url: normalized,
    role,
    state: previous?.state ?? 'connecting',
    attempt: previous?.attempt ?? 0,
    retryAt: previous?.retryAt ?? null,
    lastConnectedAt: previous?.lastConnectedAt ?? null,
    lastDisconnectedAt: previous?.lastDisconnectedAt ?? null,
    reason: previous?.reason ?? null,
    error: previous?.error ?? null,
    healthQuality: previous?.healthQuality ?? 'checking',
    latencyMs: previous?.latencyMs ?? null,
    jitterMs: previous?.jitterMs ?? null,
    packetLossPct: previous?.packetLossPct ?? null,
    lastProbeAt: previous?.lastProbeAt ?? null,
    lastHealthyAt: previous?.lastHealthyAt ?? null,
    consecutiveFailures: previous?.consecutiveFailures ?? 0,
    transport: previous?.transport ?? null,
    compatibilityStatus: previous?.compatibilityStatus ?? 'checking',
    localAppVersion: previous?.localAppVersion ?? app.getVersion(),
    remoteAppVersion: previous?.remoteAppVersion ?? null,
    remoteProtocolVersion: previous?.remoteProtocolVersion ?? null,
    remoteMinProtocolVersion: previous?.remoteMinProtocolVersion ?? null,
    compatibilityMessage: previous?.compatibilityMessage ?? null,
    lastCompatibilityCheckAt: previous?.lastCompatibilityCheckAt ?? null,
    ...patch
  })
  publishHostStates()
}

function removeHostState(url: string): void {
  const normalized = normalizeUrl(url)
  hostConnectionStates.delete(normalized)
  hostHealthSamples.delete(normalized)
  healthProbesInFlight.delete(normalized)
  publishHostStates()
}

function failReliableForHost(url: string, error: string): void {
  const normalized = normalizeUrl(url)
  for (const [key, item] of reliableOutbox) {
    if (item.targetUrl !== normalized) continue
    reliableOutbox.delete(key)
    item.callback({ success: false, error })
  }
}

// ── Multi-host (non-hoster attached to several hosts at once) ──
// The "primary" connection lives in `socket`/`currentUrl` (kept for acks +
// back-compat). These are ADDITIONAL remote host connections that carry the
// full social event set, so a user can see + message + call people on every
// host they've joined. Keyed by normalized url.
const secondaryHosts = new Map<string, Socket>()
// Per-peer host affinity: which host url(s) a given userId is currently present
// on. Learned from presence/dm/call traffic, and used to route an outgoing DM
// or call to the connection where that peer actually is.
const userHosts = new Map<string, Set<string>>()
const serverHosts = new Map<string, string>()

function noteUserOnHost(userId: string | undefined, url: string): void {
  if (!userId) return
  let set = userHosts.get(userId)
  if (!set) { set = new Set(); userHosts.set(userId, set) }
  set.add(url)
}
function forgetHost(url: string, forgetServerRoutes = true): void {
  const normalized = normalizeUrl(url)
  for (const [uid, set] of userHosts) {
    set.delete(normalized)
    if (set.size === 0) userHosts.delete(uid)
  }
  if (forgetServerRoutes) {
    for (const [serverId, hostUrl] of serverHosts) {
      if (hostUrl === normalized) serverHosts.delete(serverId)
    }
  }
}

/** Every live social connection: the primary plus every secondary host. */
function allSocialSockets(): Socket[] {
  const out: Socket[] = []
  if (socket) out.push(socket)
  for (const s of secondaryHosts.values()) out.push(s)
  for (const s of auxiliarySockets.values()) out.push(s)
  return out
}
function socketForHostUrl(url: string): Socket | null {
  if (normalizeUrl(url) === normalizeUrl(currentUrl)) return socket
  return secondaryHosts.get(normalizeUrl(url)) ?? auxiliarySockets.get(normalizeUrl(url)) ?? null
}
function hostUrlForSocket(target: Socket): string | null {
  if (target === socket) return currentUrl ? normalizeUrl(currentUrl) : null
  for (const [url, candidate] of secondaryHosts) if (candidate === target) return url
  for (const [url, candidate] of auxiliarySockets) if (candidate === target) return url
  return null
}
function isHostUsable(url: string): boolean {
  const compatibility = compatibilityForHost(url)
  return compatibility !== 'checking' && compatibility !== 'incompatible'
}
function listHostUrls(): string[] {
  const urls = new Set<string>()
  if (socket?.connected && currentUrl && isHostUsable(currentUrl)) urls.add(normalizeUrl(currentUrl))
  for (const [url, s] of secondaryHosts) {
    if (s.connected && isHostUsable(url)) urls.add(url)
  }
  for (const [url, s] of auxiliarySockets) {
    if (s.connected && isHostUsable(url)) urls.add(url)
  }
  return [...urls]
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function cleanupHostRoute(url: string): void {
  if (!url) return
  forgetHost(normalizeUrl(url))
  voiceUdp.removeHost(url)
  sendToRenderer('signaling:hosts-changed', listHostUrls())
}

function disconnectPrimarySocketForSwitch(notify = false): void {
  const existing = socket
  const previousUrl = currentUrl
  if (!existing) return
  intentionalDisconnects.add(existing)
  try { existing.disconnect() } catch { /* ignore */ }
  cleanupHostRoute(previousUrl)
  failReliableForHost(previousUrl, 'Disconnected from the message host.')
  removeHostState(previousUrl)
  if (notify) sendToRenderer('signaling:disconnected', 'manual')
}

// Self-announce events go to EVERY host; friend/message requests are dedup-safe
// so they're broadcast too (find the person wherever they are).
const BROADCAST_EVENTS = new Set<string>([
  'presence:update',
  'status:update',
  'status:set-friends'
])
const REPLAYABLE_BROADCAST_EVENTS = new Set<string>([
  'presence:update',
  'status:update',
  'status:set-friends'
])
const replayableBroadcasts = new Map<string, unknown[]>()

function isBroadcastEvent(event: string): boolean {
  return BROADCAST_EVENTS.has(event) || event.startsWith('friend-request:') || event.startsWith('message-request:')
}

function rememberReplayableBroadcast(event: string, args: unknown[]): void {
  if (REPLAYABLE_BROADCAST_EVENTS.has(event)) replayableBroadcasts.set(event, args)
}

function replaySocialState(target: Socket): void {
  if (!target.connected) return
  for (const [event, args] of replayableBroadcasts) {
    target.emit(event, ...args)
  }
}
// Peer-targeted realtime events: route to the host where the peer is present.
function targetUserIdFor(event: string, args: unknown[]): string | null {
  if (
    event === 'dm-message' || event === 'dm-edit' || event === 'dm-delete' || event === 'dm-pin' || event === 'dm-reaction' ||
    event === 'call-invite' || event === 'call-accept' || event === 'call-reject' ||
    event === 'call-end' || event === 'call-video-state'
  ) {
    return typeof args[0] === 'string' ? args[0] : null
  }
  return null
}

// Outbound events emitted while the socket was down. socket.io's own send
// buffer dies with the socket object, and our reconnect creates a NEW socket
// each attempt — so without this queue, every emit during a reconnect window
// (DM sends, reactions, edits...) vanished while the UI showed "sent".
// Flushed right after register-user on the next successful connect.
const MAX_PENDING_EMITS = 200
let pendingEmits: Array<{ event: string; args: unknown[] }> = []

function queuePendingEmit(event: string, args: unknown[]): void {
  if (pendingEmits.length < MAX_PENDING_EMITS) pendingEmits.push({ event, args })
}

interface ReliableEmit {
  key: string
  event: string
  arg: unknown
  targetUrl: string
  attempts: number
  inFlight: boolean
  callback: (response: { success: boolean; error?: string; duplicate?: boolean }) => void
}
const reliableOutbox = new Map<string, ReliableEmit>()
const MAX_RELIABLE_ATTEMPTS = 5

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
  voiceUdp.setMainWindow(win)
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

const serverEvents = [
  'server:join-ack',
  'server:join-denied',
  'server:member-joined',
  'server:member-left',
  'server:message',
  'server:message-edit',
  'server:message-delete',
  'server:message-pin',
  'server:message-reaction',
  'server:member-muted',
  'server:member-kicked',
  'server:member-banned',
  'server:member-role-changed',
  'server:you-were-kicked',
  'server:you-were-banned',
  'server:host-online',
  'server:layout',
  'server:role-names',
  'server:roles',
  'server:member-roles',
  'server:voice-joined',
  'server:voice-left',
  'server:voice-occupants',
  'server:voice-join-denied',
  'server:stream-start',
  'server:stream-pause',
  'server:stream-stop',
  'server:error'
]

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function socketTransport(sock: Socket): string | null {
  return sock.io.engine?.transport?.name ?? null
}

function recordHostHealth(url: string, ok: boolean, latencyMs: number | null, error: string | null): void {
  const normalized = normalizeUrl(url)
  const snapshot = hostConnectionStates.get(normalized)
  if (!snapshot) return

  const samples = [...(hostHealthSamples.get(normalized) ?? []), { ok, latencyMs }].slice(-12)
  hostHealthSamples.set(normalized, samples)
  const successfulLatencies = samples
    .filter((sample): sample is { ok: true; latencyMs: number } => sample.ok && sample.latencyMs != null)
    .map((sample) => sample.latencyMs)
  const packetLossPct = Math.round((samples.filter((sample) => !sample.ok).length / samples.length) * 100)
  const jitterMs = successfulLatencies.length > 1
    ? Math.round(successfulLatencies.slice(1).reduce((total, latency, index) => {
        return total + Math.abs(latency - successfulLatencies[index])
      }, 0) / (successfulLatencies.length - 1))
    : null
  const consecutiveFailures = ok ? 0 : snapshot.consecutiveFailures + 1
  const currentLatency = ok ? latencyMs : snapshot.latencyMs
  const healthQuality: HostHealthQuality = consecutiveFailures >= 3
    ? 'unreachable'
    : !ok || packetLossPct >= 5 || (currentLatency ?? 0) >= 180 || (jitterMs ?? 0) >= 80
      ? 'degraded'
      : 'healthy'

  updateHostState(normalized, snapshot.role, {
    healthQuality,
    latencyMs: currentLatency,
    jitterMs,
    packetLossPct,
    lastProbeAt: Date.now(),
    lastHealthyAt: ok ? Date.now() : snapshot.lastHealthyAt,
    consecutiveFailures,
    transport: socketForHostUrl(normalized) ? socketTransport(socketForHostUrl(normalized)!) : snapshot.transport,
    error: error ?? (ok ? null : snapshot.error)
  })
}

function probeHostSocket(url: string, sock: Socket): Promise<void> {
  const normalized = normalizeUrl(url)
  if (!sock.connected || healthProbesInFlight.has(normalized)) return Promise.resolve()
  healthProbesInFlight.add(normalized)
  const startedAt = Date.now()

  return new Promise((resolve) => {
    sock.timeout(3500).emit('health:ping', { sentAt: startedAt }, (err: Error | null) => {
      healthProbesInFlight.delete(normalized)
      if (err) recordHostHealth(normalized, false, null, 'Health check timed out.')
      else recordHostHealth(normalized, true, Date.now() - startedAt, null)
      resolve()
    })
  })
}

export async function checkHostHealth(serverUrl?: string): Promise<HostConnectionSnapshot[]> {
  const requested = serverUrl ? normalizeUrl(serverUrl) : null
  const probes: Promise<void>[] = []
  for (const status of hostConnectionStates.values()) {
    if (requested && status.url !== requested) continue
    const target = socketForHostUrl(status.url)
    if (target?.connected) probes.push(probeHostSocket(status.url, target))
  }
  await Promise.all(probes)
  return listHostConnectionStatuses()
}

function startHostHealthMonitor(): void {
  if (hostHealthTimer) return
  hostHealthTimer = setInterval(() => {
    void checkHostHealth()
  }, 5000)
  hostHealthTimer.unref?.()
}

function markHostTransportDown(url: string, role: HostConnectionSnapshot['role']): void {
  const snapshot = hostConnectionStates.get(normalizeUrl(url))
  updateHostState(url, role, {
    healthQuality: 'unreachable',
    lastProbeAt: Date.now(),
    consecutiveFailures: (snapshot?.consecutiveFailures ?? 0) + 1
  })
}

function negotiateHostCompatibility(
  url: string,
  role: HostConnectionSnapshot['role'],
  sock: Socket
): Promise<boolean | null> {
  const localAppVersion = app.getVersion()
  updateHostState(url, role, {
    compatibilityStatus: 'checking',
    localAppVersion,
    remoteAppVersion: null,
    remoteProtocolVersion: null,
    remoteMinProtocolVersion: null,
    compatibilityMessage: 'Checking host compatibility.'
  })

  return new Promise((resolve) => {
    sock.timeout(2500).emit('compatibility:hello', {
      appVersion: localAppVersion,
      protocolVersion: MESH_PROTOCOL_VERSION,
      minProtocolVersion: MESH_MIN_PROTOCOL_VERSION
    }, (err: Error | null, response?: CompatibilityResponse) => {
      if (!sock.connected) {
        resolve(null)
        return
      }
      if (err || !response || typeof response.compatible !== 'boolean') {
        updateHostState(url, role, {
          compatibilityStatus: 'legacy',
          localAppVersion,
          compatibilityMessage: 'This host predates compatibility checks. Core features may work, but its protocol cannot be verified.',
          lastCompatibilityCheckAt: Date.now()
        })
        resolve(true)
        return
      }

      updateHostState(url, role, {
        compatibilityStatus: response.status,
        localAppVersion,
        remoteAppVersion: response.hostAppVersion,
        remoteProtocolVersion: response.hostProtocolVersion,
        remoteMinProtocolVersion: response.hostMinProtocolVersion,
        compatibilityMessage: response.message,
        lastCompatibilityCheckAt: Date.now()
      })
      resolve(response.compatible)
    })
  })
}

function compatibilityForHost(url: string): CompatibilityStatus | null {
  return hostConnectionStates.get(normalizeUrl(url))?.compatibilityStatus ?? null
}

function rejectIncompatibleHost(url: string): boolean {
  if (compatibilityForHost(url) !== 'incompatible') return false
  const message = `Cannot use ${normalizeUrl(url)} because its MESH protocol is incompatible.`
  sendToRenderer('signaling:error', message)
  return true
}

function noteServerOnHost(serverId: string | undefined, url: string): void {
  if (!serverId || !url) return
  serverHosts.set(serverId, normalizeUrl(url))
}

function serverIdFromVoiceRoom(roomId: string): string | null {
  const parts = roomId.split(':')
  return parts[0] === 'voice' && parts[1] ? parts[1] : null
}

function voiceUdpTargetUrl(roomId: string): string {
  const serverId = serverIdFromVoiceRoom(roomId)
  const hosted = hostedRouteForServer(serverId)
  if (hosted) return hosted.url
  if (serverId) {
    const mapped = serverHosts.get(serverId)
    if (mapped) return mapped
  }
  return currentUrl
}

function normalizePort(value: unknown): number {
  const raw = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(raw)) return 3000
  return Math.min(65535, Math.max(1, Math.floor(raw)))
}

function hostedRouteForServer(serverId: string | null, forcedPort?: number): { url: string; userId: string } | null {
  if (!serverId) return null
  const server = getServer(serverId)
  if (!server || server.role !== 'host') return null

  let network: {
    hostPort?: number
    serverHostAssignments?: Record<string, { port?: number }>
  } | null = null
  try {
    const raw = getSetting('network')
    network = raw ? JSON.parse(raw) : null
  } catch {
    network = null
  }

  const primaryPort = normalizePort(network?.hostPort)
  const assignedPort = normalizePort(forcedPort ?? network?.serverHostAssignments?.[serverId]?.port ?? primaryPort)
  return {
    url: `http://localhost:${assignedPort}`,
    userId: server.hostUserId
  }
}

function routeForEvent(event: string, args: unknown[]): { url: string; userId: string } | null {
  if (event.startsWith('server:')) {
    const payload = args[0] as { serverId?: unknown } | undefined
    const forcedPort = event === 'server:unregister' && typeof (payload as { port?: unknown })?.port === 'number'
      ? (payload as { port: number }).port
      : undefined
    const serverId = typeof payload?.serverId === 'string' ? payload.serverId : null
    const hosted = hostedRouteForServer(serverId, forcedPort)
    if (hosted) return hosted
    const mappedUrl = serverId ? serverHosts.get(serverId) : null
    return mappedUrl && currentUserId ? { url: mappedUrl, userId: currentUserId } : null
  }
  if (event === 'join-room' || event === 'leave-room') {
    const roomId = typeof args[0] === 'string' ? args[0] : ''
    const parts = roomId.split(':')
    if (parts[0] !== 'voice') return null
    const serverId = parts[1] ?? null
    const hosted = hostedRouteForServer(serverId)
    const mappedUrl = serverId ? serverHosts.get(serverId) : null
    return hosted ?? (mappedUrl && currentUserId ? { url: mappedUrl, userId: currentUserId } : null)
  }
  if (event.startsWith('media:')) {
    const roomId = typeof args[0] === 'string' ? args[0] : ''
    const parts = roomId.split(':')
    if (parts[0] !== 'voice') return null
    const serverId = parts[1] ?? null
    const hosted = hostedRouteForServer(serverId)
    const mappedUrl = serverId ? serverHosts.get(serverId) : null
    return hosted ?? (mappedUrl && currentUserId ? { url: mappedUrl, userId: currentUserId } : null)
  }
  if (event === 'stream:start' || event === 'stream:pause' || event === 'stream:stop') {
    const serverId = typeof args[0] === 'string' ? args[0] : null
    const hosted = hostedRouteForServer(serverId)
    const mappedUrl = serverId ? serverHosts.get(serverId) : null
    return hosted ?? (mappedUrl && currentUserId ? { url: mappedUrl, userId: currentUserId } : null)
  }
  return null
}

function attachAuxiliaryHandlers(aux: Socket, userId: string, url: string): void {
  aux.on('connect', () => {
    aux.emit('register-user', userId)
    aux.emit('connection-role', 'auxiliary')
    replaySocialState(aux)
    setTimeout(() => flushReliableOutbox(url), 700)
  })
  aux.on('connect_error', (err) => {
    console.warn('[socket-client] auxiliary connection failed:', err.message)
  })
  aux.on('user-joined', (joinedUserId: string, socketId: string, roomId?: string) => {
    sendToRenderer('signaling:user-joined', joinedUserId, socketId, roomId)
  })
  aux.on('user-left', (leftUserId: string, socketId: string, roomId?: string) => {
    sendToRenderer('signaling:user-left', leftUserId, socketId, roomId)
  })
  aux.on('media:audio', (fromUserId: string, meta: unknown, payload: unknown) => {
    sendToRenderer('signaling:media:audio', fromUserId, meta, payload)
  })
  aux.on('media:video', (fromUserId: string, meta: unknown, payload: unknown) => {
    sendToRenderer('signaling:media:video', fromUserId, meta, payload)
  })
  aux.on('media:pong', (sentAt: unknown) => {
    sendToRenderer('signaling:media:pong', sentAt)
  })
  aux.on('media:keyframe-request', (roomId: string, fromUserId?: string) => {
    sendToRenderer('signaling:media:keyframe-request', roomId, fromUserId)
  })
  aux.on('dm-message', (fromUserId: string, message: string) => {
    noteUserOnHost(fromUserId, url)
    sendToRenderer('signaling:dm-message', fromUserId, message)
  })
  aux.on('dm-edit', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:dm-edit', fromUserId, payload)
  })
  aux.on('dm-delete', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:dm-delete', fromUserId, payload)
  })
  aux.on('dm-pin', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:dm-pin', fromUserId, payload)
  })
  aux.on('dm-reaction', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:dm-reaction', fromUserId, payload)
  })
  aux.on('call-invite', (fromUserId: string, callData: unknown) => {
    noteUserOnHost(fromUserId, url)
    sendToRenderer('signaling:call-invite', fromUserId, callData)
  })
  aux.on('call-accept', (fromUserId: string) => {
    sendToRenderer('signaling:call-accept', fromUserId)
  })
  aux.on('call-reject', (fromUserId: string) => {
    sendToRenderer('signaling:call-reject', fromUserId)
  })
  aux.on('call-unreachable', (targetUserId: string) => {
    sendToRenderer('signaling:call-unreachable', targetUserId)
  })
  aux.on('call-end', (fromUserId: string) => {
    sendToRenderer('signaling:call-end', fromUserId)
  })
  aux.on('call-video-state', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:call-video-state', fromUserId, payload)
  })
  aux.on('friend-request:incoming', (payload: unknown) => {
    noteUserOnHost((payload as { fromUserId?: string })?.fromUserId, url)
    sendToRenderer('signaling:friend-request:incoming', payload)
  })
  aux.on('friend-request:accepted', (payload: unknown) => {
    sendToRenderer('signaling:friend-request:accepted', payload)
  })
  aux.on('friend-request:rejected', (payload: unknown) => {
    sendToRenderer('signaling:friend-request:rejected', payload)
  })
  aux.on('friend-request:cancelled', (payload: unknown) => {
    sendToRenderer('signaling:friend-request:cancelled', payload)
  })
  aux.on('presence:changed', (payload: unknown) => {
    const p = payload as { userId?: string; removed?: boolean }
    if (p?.removed) userHosts.get(p.userId ?? '')?.delete(url)
    else noteUserOnHost(p?.userId, url)
    sendToRenderer('signaling:presence:changed', payload, url)
  })
  aux.on('presence:snapshot', (payload: unknown) => {
    if (Array.isArray(payload)) for (const e of payload) noteUserOnHost((e as { userId?: string })?.userId, url)
    sendToRenderer('signaling:presence:snapshot', payload, url)
  })
  aux.on('status:changed', (payload: unknown) => {
    noteUserOnHost((payload as { userId?: string })?.userId, url)
    sendToRenderer('signaling:status:changed', payload)
  })
  aux.on('status:snapshot', (payload: unknown) => {
    sendToRenderer('signaling:status:snapshot', payload)
  })
  aux.on('message-request:incoming', (payload: unknown) => {
    noteUserOnHost((payload as { fromUserId?: string })?.fromUserId, url)
    sendToRenderer('signaling:message-request:incoming', payload)
  })
  aux.on('message-request:message-incoming', (payload: unknown) => {
    sendToRenderer('signaling:message-request:message-incoming', payload)
  })
  for (const evt of serverEvents) {
    aux.on(evt, (payload: unknown) => {
      sendToRenderer(`signaling:${evt}`, payload)
    })
  }
}

/**
 * Full social-event forwarding for a SECONDARY host connection, so a user
 * attached to several hosts sees + receives from all of them. Mirrors the
 * primary socket's forwarders and additionally records per-peer host affinity
 * (which host a user is on) so outgoing DMs/calls route to the right host.
 */
function attachSecondaryHandlers(sock: Socket, url: string): void {
  const fwd = (evt: string, ...rest: unknown[]): void => sendToRenderer(`signaling:${evt}`, ...rest)

  sock.on('user-joined', (uid: string, socketId: string, roomId?: string) => { noteUserOnHost(uid, url); fwd('user-joined', uid, socketId, roomId) })
  sock.on('user-left', (uid: string, socketId: string, roomId?: string) => fwd('user-left', uid, socketId, roomId))
  sock.on('offer', (fromSocketId: string, offer: unknown, fromUserId: string) => fwd('offer', fromSocketId, offer, fromUserId))
  sock.on('answer', (fromSocketId: string, answer: unknown) => fwd('answer', fromSocketId, answer))
  sock.on('ice-candidate', (fromSocketId: string, candidate: unknown) => fwd('ice-candidate', fromSocketId, candidate))

  sock.on('dm-message', (fromUserId: string, message: string) => { noteUserOnHost(fromUserId, url); fwd('dm-message', fromUserId, message) })
  sock.on('dm-edit', (fromUserId: string, payload: unknown) => fwd('dm-edit', fromUserId, payload))
  sock.on('dm-delete', (fromUserId: string, payload: unknown) => fwd('dm-delete', fromUserId, payload))
  sock.on('dm-pin', (fromUserId: string, payload: unknown) => fwd('dm-pin', fromUserId, payload))
  sock.on('dm-reaction', (fromUserId: string, payload: unknown) => fwd('dm-reaction', fromUserId, payload))

  sock.on('call-invite', (fromUserId: string, callData: unknown) => { noteUserOnHost(fromUserId, url); fwd('call-invite', fromUserId, callData) })
  sock.on('call-accept', (fromUserId: string) => fwd('call-accept', fromUserId))
  sock.on('call-reject', (fromUserId: string) => fwd('call-reject', fromUserId))
  sock.on('call-unreachable', (targetUserId: string) => fwd('call-unreachable', targetUserId))
  sock.on('call-end', (fromUserId: string) => fwd('call-end', fromUserId))
  sock.on('call-video-state', (fromUserId: string, payload: unknown) => fwd('call-video-state', fromUserId, payload))

  sock.on('media:audio', (fromUserId: string, meta: unknown, payload: unknown) => fwd('media:audio', fromUserId, meta, payload))
  sock.on('media:video', (fromUserId: string, meta: unknown, payload: unknown) => fwd('media:video', fromUserId, meta, payload))
  sock.on('media:pong', (sentAt: unknown) => fwd('media:pong', sentAt))
  sock.on('media:keyframe-request', (roomId: string, fromUserId?: string) => fwd('media:keyframe-request', roomId, fromUserId))

  sock.on('friend-request:incoming', (payload: unknown) => { noteUserOnHost((payload as { fromUserId?: string })?.fromUserId, url); fwd('friend-request:incoming', payload) })
  sock.on('friend-request:accepted', (payload: unknown) => fwd('friend-request:accepted', payload))
  sock.on('friend-request:rejected', (payload: unknown) => fwd('friend-request:rejected', payload))
  sock.on('friend-request:cancelled', (payload: unknown) => fwd('friend-request:cancelled', payload))

  sock.on('presence:changed', (payload: unknown) => {
    const p = payload as { userId?: string; removed?: boolean }
    if (p?.removed) userHosts.get(p.userId ?? '')?.delete(url)
    else noteUserOnHost(p?.userId, url)
    sendToRenderer('signaling:presence:changed', payload, url)
  })
  sock.on('presence:snapshot', (payload: unknown) => {
    if (Array.isArray(payload)) for (const e of payload) noteUserOnHost((e as { userId?: string })?.userId, url)
    sendToRenderer('signaling:presence:snapshot', payload, url)
  })
  sock.on('status:changed', (payload: unknown) => { noteUserOnHost((payload as { userId?: string })?.userId, url); fwd('status:changed', payload) })
  sock.on('status:snapshot', (payload: unknown) => fwd('status:snapshot', payload))

  sock.on('message-request:incoming', (payload: unknown) => { noteUserOnHost((payload as { fromUserId?: string })?.fromUserId, url); fwd('message-request:incoming', payload) })
  sock.on('message-request:message-incoming', (payload: unknown) => fwd('message-request:message-incoming', payload))

  for (const evt of serverEvents) {
    sock.on(evt, (payload: unknown) => {
      noteServerOnHost((payload as { serverId?: string } | null)?.serverId, url)
      fwd(evt, payload)
    })
  }
}

/** Attach an additional remote host so the user is present on it too. Idempotent. */
export function connectSecondaryHost(serverUrl: string): void {
  const url = normalizeUrl(serverUrl)
  if (!url || !currentUserId) return
  if (url === normalizeUrl(currentUrl)) return          // already the primary
  if (secondaryHosts.has(url)) return                    // already attached
  updateHostState(url, 'secondary', {
    state: 'connecting',
    attempt: 0,
    retryAt: null,
    reason: null,
    error: null
  })
  const sock = io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.25
  })
  secondaryHosts.set(url, sock)
  startHostHealthMonitor()
  sock.on('connect', () => {
    sock.emit('register-user', currentUserId)
    sock.emit('connection-role', 'secondary')
    updateHostState(url, 'secondary', {
      state: 'connected',
      attempt: 0,
      retryAt: null,
      lastConnectedAt: Date.now(),
      reason: null,
      error: null,
      healthQuality: 'checking',
      consecutiveFailures: 0,
      transport: socketTransport(sock)
    })
    sendToRenderer('signaling:hosts-changed', listHostUrls())
    setTimeout(() => void checkHostHealth(url), 350)
    void negotiateHostCompatibility(url, 'secondary', sock).then((compatible) => {
      if (!sock.connected) return
      if (compatible === false) {
        failReliableForHost(url, 'This host uses an incompatible MESH protocol.')
        sendToRenderer('signaling:error', `Additional host ${url} uses an incompatible MESH protocol.`)
        return
      }
      replaySocialState(sock)
      voiceUdp.configureHost(url, currentUserId)
      sendToRenderer('signaling:connected')
      sendToRenderer('signaling:hosts-changed', listHostUrls())
      setTimeout(() => flushReliableOutbox(url), 150)
    })
  })
  sock.on('disconnect', (reason) => {
    // Keep server affinity during a transient outage. Re-registration must
    // still know which host owns each joined server after the socket returns.
    forgetHost(url, false)
    voiceUdp.removeHost(url)
    updateHostState(url, 'secondary', {
      state: 'reconnecting',
      retryAt: Date.now() + 1000,
      lastDisconnectedAt: Date.now(),
      reason,
      error: null
    })
    markHostTransportDown(url, 'secondary')
    sendToRenderer('signaling:hosts-changed', listHostUrls())
  })
  sock.io.on('reconnect_attempt', (attempt) => {
    const delay = Math.min(1000 * Math.max(1, attempt), 30000)
    updateHostState(url, 'secondary', {
      state: attempt >= 5 ? 'offline' : 'reconnecting',
      attempt,
      retryAt: Date.now() + delay
    })
  })
  sock.on('connect_error', (err) => {
    const previous = hostConnectionStates.get(url)
    const attempt = Math.max(1, previous?.attempt ?? 0)
    updateHostState(url, 'secondary', {
      state: attempt >= 5 ? 'offline' : 'reconnecting',
      attempt,
      error: err.message
    })
    console.warn('[socket-client] secondary host failed:', url, err.message)
  })
  attachSecondaryHandlers(sock, url)
}

/** Detach an additional remote host (leaves the primary alone). */
export function disconnectSecondaryHost(serverUrl: string): void {
  const url = normalizeUrl(serverUrl)
  const sock = secondaryHosts.get(url)
  if (!sock) return
  try { sock.removeAllListeners(); sock.disconnect() } catch { /* ignore */ }
  secondaryHosts.delete(url)
  forgetHost(url)
  voiceUdp.removeHost(url)
  failReliableForHost(url, 'Disconnected from the message host.')
  removeHostState(url)
  sendToRenderer('signaling:hosts-changed', listHostUrls())
}

export function listConnectedHosts(): string[] {
  return listHostUrls()
}

export function listHostConnectionStatuses(): HostConnectionSnapshot[] {
  return [...hostConnectionStates.values()].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'primary' ? -1 : 1
    return a.url.localeCompare(b.url)
  })
}

function auxiliarySocketFor(serverUrl: string, userId: string): Socket {
  const url = normalizeUrl(serverUrl)
  const existing = auxiliarySockets.get(url)
  if (existing && existing.connected) return existing
  if (existing) {
    existing.removeAllListeners()
    existing.disconnect()
  }

  const aux = io(url, {
    transports: ['websocket'],
    reconnection: false
  })
  auxiliarySockets.set(url, aux)
  attachAuxiliaryHandlers(aux, userId, url)
  return aux
}

function emitOnSocket(target: Socket, event: string, args: unknown[]): void {
  if (target.connected) {
    target.emit(event, ...args)
    return
  }
  target.once('connect', () => target.emit(event, ...args))
}

function dispatchReliable(item: ReliableEmit): void {
  if (item.inFlight || !reliableOutbox.has(item.key)) return
  const compatibility = compatibilityForHost(item.targetUrl)
  if (compatibility === 'checking') return
  if (compatibility === 'incompatible') {
    reliableOutbox.delete(item.key)
    item.callback({ success: false, error: 'This host uses an incompatible MESH protocol.' })
    return
  }
  let target = socketForHostUrl(item.targetUrl)
  if (!target && item.targetUrl && currentUserId) {
    target = auxiliarySocketFor(item.targetUrl, currentUserId)
  }
  if (!target?.connected) return

  item.inFlight = true
  target.timeout(6000).emit(item.event, item.arg, (
    err: Error | null,
    response?: { success?: boolean; error?: string; duplicate?: boolean }
  ) => {
    item.inFlight = false
    if (!reliableOutbox.has(item.key)) return
    if (!err && response?.success) {
      reliableOutbox.delete(item.key)
      item.callback({ success: true, duplicate: response.duplicate })
      return
    }
    if (!err && response && response.success === false) {
      const reason = response.error ?? 'Message was rejected.'
      const transient = reason === 'Server is offline.' || reason === 'You are not a member of this server.'
      if (transient && item.attempts + 1 < MAX_RELIABLE_ATTEMPTS) {
        item.attempts += 1
        setTimeout(() => dispatchReliable(item), Math.min(2000 * item.attempts, 6000))
        return
      }
      reliableOutbox.delete(item.key)
      item.callback({ success: false, error: reason })
      return
    }

    if (!target?.connected) return
    item.attempts += 1
    if (item.attempts >= MAX_RELIABLE_ATTEMPTS) {
      reliableOutbox.delete(item.key)
      item.callback({ success: false, error: 'Delivery was not acknowledged.' })
      return
    }
    setTimeout(() => dispatchReliable(item), Math.min(1500 * item.attempts, 5000))
  })
}

function flushReliableOutbox(hostUrl?: string): void {
  const normalized = hostUrl ? normalizeUrl(hostUrl) : null
  for (const item of reliableOutbox.values()) {
    if (!normalized || item.targetUrl === normalized) dispatchReliable(item)
  }
}

export function connectToSignaling(serverUrl: string, userId: string): Promise<void> {
  const normalizedUrl = normalizeUrl(serverUrl)
  // Prevent duplicate connections
  if (isConnecting) {
    console.log('[socket-client] connection already in progress, ignoring')
    return connectingPromise ?? Promise.reject(new Error('Connection already in progress.'))
  }
  if (socket?.connected && normalizeUrl(currentUrl) === normalizedUrl && currentUserId === userId) {
    console.log('[socket-client] already connected to same server, ignoring')
    return Promise.resolve()
  }

  isConnecting = true
  clearReconnectTimer()

  if (socket) {
    const isSwitch = normalizeUrl(currentUrl) !== normalizedUrl || currentUserId !== userId
    if (isSwitch) {
      disconnectPrimarySocketForSwitch(false)
    } else {
      // A reconnect replaces the old socket object, but must retain host
      // affinity and connection history for recovery.
      const stale = socket
      try {
        stale.removeAllListeners()
        stale.disconnect()
      } catch { /* ignore */ }
      socket = null
    }
  }

  currentUrl = normalizedUrl
  currentUserId = userId
  startHostHealthMonitor()
  const existingState = hostConnectionStates.get(normalizedUrl)
  updateHostState(normalizedUrl, 'primary', {
    state: existingState?.attempt ? 'reconnecting' : 'connecting',
    retryAt: null,
    reason: null,
    error: null
  })

  socket = io(normalizedUrl, {
    transports: ['websocket'],
    reconnection: false
  })
  const activeSocket = socket
  let compatibilityPromise: Promise<boolean | null> | null = null

  socket.on('connect', () => {
    clearReconnectTimer()
    updateHostState(normalizedUrl, 'primary', {
      state: 'connected',
      attempt: 0,
      retryAt: null,
      lastConnectedAt: Date.now(),
      reason: null,
      error: null,
      healthQuality: 'checking',
      consecutiveFailures: 0,
      transport: socketTransport(socket!)
    })
    activeSocket.emit('register-user', userId)
    activeSocket.emit('connection-role', 'primary')
    sendToRenderer('signaling:hosts-changed', listHostUrls())
    setTimeout(() => void checkHostHealth(normalizedUrl), 350)
    compatibilityPromise = negotiateHostCompatibility(normalizedUrl, 'primary', activeSocket)
    void compatibilityPromise.then((compatible) => {
      isConnecting = false
      connectingPromise = null
      if (!activeSocket.connected) return
      if (compatible === false) {
        sendToRenderer('signaling:reconnect-status', { state: 'failed' })
        sendToRenderer('signaling:error', `Host ${normalizedUrl} uses an incompatible MESH protocol.`)
        failReliableForHost(normalizedUrl, 'This host uses an incompatible MESH protocol.')
        return
      }

      reconnectAttempts = 0
      sendToRenderer('signaling:reconnect-status', { state: 'connected' })
      replaySocialState(activeSocket)
      voiceUdp.configureHost(normalizedUrl, userId)
      // Flush everything queued while we were offline, preserving order.
      if (pendingEmits.length > 0) {
        const toFlush = pendingEmits
        pendingEmits = []
        console.log(`[socket-client] flushing ${toFlush.length} queued emit(s)`)
        for (const { event, args } of toFlush) activeSocket.emit(event, ...args)
      }
      sendToRenderer('signaling:connected')
      sendToRenderer('signaling:hosts-changed', listHostUrls())
      setTimeout(() => flushReliableOutbox(normalizedUrl), 150)
    })
  })

  socket.on('disconnect', (reason) => {
    if (intentionalDisconnects.has(activeSocket)) {
      intentionalDisconnects.delete(activeSocket)
      return
    }
    isConnecting = false
    connectingPromise = null
    sendToRenderer('signaling:disconnected', reason)
    forgetHost(normalizedUrl, false)
    voiceUdp.removeHost(normalizedUrl)
    updateHostState(normalizedUrl, 'primary', {
      state: 'reconnecting',
      retryAt: Date.now() + 1000,
      lastDisconnectedAt: Date.now(),
      reason,
      error: null
    })
    markHostTransportDown(normalizedUrl, 'primary')
    sendToRenderer('signaling:hosts-changed', listHostUrls())
    tryReconnect()
  })

  socket.on('connect_error', (err) => {
    isConnecting = false
    connectingPromise = null
    sendToRenderer('signaling:error', err.message)
    updateHostState(normalizedUrl, 'primary', {
      state: reconnectAttempts >= 5 ? 'offline' : 'reconnecting',
      error: err.message
    })
    // A socket that never connected fires connect_error, NOT disconnect —
    // without retrying here, an app started before the signaling host was
    // up stayed offline forever.
    tryReconnect()
  })

  // Forward signaling events to renderer
  socket.on('user-joined', (userId: string, socketId: string, roomId?: string) => {
    sendToRenderer('signaling:user-joined', userId, socketId, roomId)
  })

  socket.on('user-left', (userId: string, socketId: string, roomId?: string) => {
    sendToRenderer('signaling:user-left', userId, socketId, roomId)
  })

  socket.on('offer', (fromSocketId: string, offer: unknown, fromUserId: string) => {
    sendToRenderer('signaling:offer', fromSocketId, offer, fromUserId)
  })

  socket.on('answer', (fromSocketId: string, answer: unknown) => {
    sendToRenderer('signaling:answer', fromSocketId, answer)
  })

  socket.on('ice-candidate', (fromSocketId: string, candidate: unknown) => {
    sendToRenderer('signaling:ice-candidate', fromSocketId, candidate)
  })

  socket.on('dm-message', (fromUserId: string, message: string) => {
    sendToRenderer('signaling:dm-message', fromUserId, message)
  })

  socket.on('dm-edit', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:dm-edit', fromUserId, payload)
  })

  socket.on('dm-delete', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:dm-delete', fromUserId, payload)
  })

  socket.on('dm-pin', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:dm-pin', fromUserId, payload)
  })

  socket.on('dm-reaction', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:dm-reaction', fromUserId, payload)
  })

  socket.on('call-invite', (fromUserId: string, callData: unknown) => {
    sendToRenderer('signaling:call-invite', fromUserId, callData)
  })

  socket.on('call-accept', (fromUserId: string) => {
    sendToRenderer('signaling:call-accept', fromUserId)
  })

  socket.on('call-reject', (fromUserId: string) => {
    sendToRenderer('signaling:call-reject', fromUserId)
  })

  socket.on('call-unreachable', (targetUserId: string) => {
    sendToRenderer('signaling:call-unreachable', targetUserId)
  })

  socket.on('call-end', (fromUserId: string) => {
    sendToRenderer('signaling:call-end', fromUserId)
  })

  socket.on('call-video-state', (fromUserId: string, payload: unknown) => {
    sendToRenderer('signaling:call-video-state', fromUserId, payload)
  })

  // Host-relayed media frames (voice/video) — hot path, forwarded verbatim.
  socket.on('media:audio', (fromUserId: string, meta: unknown, payload: unknown) => {
    sendToRenderer('signaling:media:audio', fromUserId, meta, payload)
  })
  socket.on('media:video', (fromUserId: string, meta: unknown, payload: unknown) => {
    sendToRenderer('signaling:media:video', fromUserId, meta, payload)
  })
  socket.on('media:pong', (sentAt: unknown) => {
    sendToRenderer('signaling:media:pong', sentAt)
  })
  socket.on('media:keyframe-request', (roomId: string, fromUserId?: string) => {
    sendToRenderer('signaling:media:keyframe-request', roomId, fromUserId)
  })

  // Friend-request events (server → us)
  socket.on('friend-request:incoming', (payload: unknown) => {
    sendToRenderer('signaling:friend-request:incoming', payload)
  })
  socket.on('friend-request:accepted', (payload: unknown) => {
    sendToRenderer('signaling:friend-request:accepted', payload)
  })
  socket.on('friend-request:rejected', (payload: unknown) => {
    sendToRenderer('signaling:friend-request:rejected', payload)
  })
  socket.on('friend-request:cancelled', (payload: unknown) => {
    sendToRenderer('signaling:friend-request:cancelled', payload)
  })

  socket.on('presence:changed', (payload: unknown) => {
    sendToRenderer('signaling:presence:changed', payload, normalizeUrl(currentUrl))
  })

  socket.on('presence:snapshot', (payload: unknown) => {
    sendToRenderer('signaling:presence:snapshot', payload, normalizeUrl(currentUrl))
  })

  socket.on('status:changed', (payload: unknown) => {
    sendToRenderer('signaling:status:changed', payload)
  })

  socket.on('status:snapshot', (payload: unknown) => {
    sendToRenderer('signaling:status:snapshot', payload)
  })

  socket.on('message-request:incoming', (payload: unknown) => {
    sendToRenderer('signaling:message-request:incoming', payload)
  })
  socket.on('message-request:message-incoming', (payload: unknown) => {
    sendToRenderer('signaling:message-request:message-incoming', payload)
  })

  // Community server events
  for (const evt of serverEvents) {
    socket.on(evt, (payload: unknown) => {
      noteServerOnHost((payload as { serverId?: string } | null)?.serverId, normalizeUrl(currentUrl))
      // Log join-ack for debugging
      if (evt === 'server:join-ack') {
        console.log('[socket-client] server:join-ack received:', JSON.stringify(payload, null, 2).slice(0, 500))
      }
      sendToRenderer(`signaling:${evt}`, payload)
    })
  }

  connectingPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (activeSocket.connected) {
        resolve()
        return
      }
      isConnecting = false
      connectingPromise = null
      const err = new Error(`Connection to ${normalizedUrl} timed out.`)
      intentionalDisconnects.add(activeSocket)
      try { activeSocket.disconnect() } catch { /* ignore */ }
      if (socket === activeSocket) socket = null
      forgetHost(normalizedUrl, false)
      voiceUdp.removeHost(normalizedUrl)
      sendToRenderer('signaling:hosts-changed', listHostUrls())
      updateHostState(normalizedUrl, 'primary', {
        state: reconnectAttempts >= 5 ? 'offline' : 'reconnecting',
        error: err.message,
        reason: 'timeout'
      })
      sendToRenderer('signaling:error', err.message)
      tryReconnect()
      reject(err)
    }, 8000)

    activeSocket.once('connect', () => {
      const negotiation = compatibilityPromise ?? Promise.resolve(true)
      void negotiation.then((compatible) => {
        clearTimeout(timeout)
        if (compatible === true) resolve()
        else if (compatible === false) reject(new Error(`Host ${normalizedUrl} uses an incompatible MESH protocol.`))
        else reject(new Error(`Connection to ${normalizedUrl} closed during the compatibility check.`))
      })
    })
    activeSocket.once('connect_error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
  return connectingPromise
}

function tryReconnect(): void {
  if (!currentUrl || !currentUserId) return
  // Collapse concurrent triggers (disconnect + connect_error) into one timer.
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  // Never give up. The signaling host is often another friend's machine that
  // comes and goes — a hard attempt cap left users permanently offline (and
  // unable to join any server) after ~50s of host downtime, until they
  // restarted the app. Backoff is capped at 30s so a returning host is
  // picked up quickly without hammering the network.
  reconnectAttempts++
  sendToRenderer('signaling:reconnect-status', { state: 'reconnecting', attempt: reconnectAttempts, max: null })

  const delay = Math.min(5000 * reconnectAttempts, 30000)
  updateHostState(currentUrl, 'primary', {
    state: reconnectAttempts >= 5 ? 'offline' : 'reconnecting',
    attempt: reconnectAttempts,
    retryAt: Date.now() + delay
  })
  reconnectTimer = setTimeout(() => {
    if (socket?.connected) return
    connectToSignaling(currentUrl, currentUserId).catch(() => {})
  }, delay)
}

export function disconnectFromSignaling(): void {
  clearReconnectTimer()
  reconnectAttempts = 0
  isConnecting = false
  connectingPromise = null
  disconnectPrimarySocketForSwitch(true)
  socket = null
  voiceUdp.reset()
}

export function emitSignaling(event: string, ...args: unknown[]): void {
  rememberReplayableBroadcast(event, args)
  const route = routeForEvent(event, args)
  if (route) {
    const routeUrl = normalizeUrl(route.url)
    if (rejectIncompatibleHost(routeUrl)) return
    if (compatibilityForHost(routeUrl) === 'checking') {
      queuePendingEmit(event, args)
      return
    }
    const existing = socketForHostUrl(routeUrl)
    if (existing) {
      emitOnSocket(existing, event, args)
      return
    }
    emitOnSocket(auxiliarySocketFor(routeUrl, route.userId), event, args)
    return
  }

  // Self-announce + dedup-safe requests fan out to EVERY host we're on, so we
  // appear on all of them and friend requests find people wherever they are.
  if (isBroadcastEvent(event)) {
    const targets = allSocialSockets()
    if (targets.length > 0) {
      for (const s of targets) {
        const hostUrl = hostUrlForSocket(s)
        const compatibility = hostUrl ? compatibilityForHost(hostUrl) : null
        if (compatibility === 'checking' || compatibility === 'incompatible') continue
        emitOnSocket(s, event, args)
      }
      return
    }
  }

  // Peer-targeted realtime (DM / call) → the single host where that peer is
  // currently present, so it reaches them even if that's a secondary host.
  if (secondaryHosts.size > 0) {
    const target = targetUserIdFor(event, args)
    const hosts = target ? userHosts.get(target) : undefined
    if (hosts && hosts.size > 0) {
      const hostUrl = [...hosts][0]
      if (rejectIncompatibleHost(hostUrl)) return
      const s = socketForHostUrl(hostUrl)
      if (s && compatibilityForHost(hostUrl) !== 'checking') { emitOnSocket(s, event, args); return }
    }
  }

  if (socket?.connected) {
    if (rejectIncompatibleHost(currentUrl)) return
    if (compatibilityForHost(currentUrl) === 'checking') {
      queuePendingEmit(event, args)
      return
    }
    emitOnSocket(socket, event, args)
    return
  }
  // Socket down — queue for the flush that follows the next connect.
  queuePendingEmit(event, args)
}

export function emitSignalingWithAck(
  event: string,
  arg: unknown,
  cb: (response: unknown) => void
): void {
  if (rejectIncompatibleHost(currentUrl)) { cb(null); return }
  if (!socket) { cb(null); return }
  if (arg === undefined) socket.emit(event, cb)
  else socket.emit(event, arg, cb)
}

export function emitReliableSignaling(
  event: string,
  arg: unknown,
  key: string,
  callback: (response: { success: boolean; error?: string; duplicate?: boolean }) => void
): { queued: boolean } {
  const route = routeForEvent(event, [arg])
  const targetUrl = normalizeUrl(route?.url || currentUrl)
  const item: ReliableEmit = {
    key,
    event,
    arg,
    targetUrl,
    attempts: 0,
    inFlight: false,
    callback
  }
  reliableOutbox.set(key, item)
  dispatchReliable(item)
  const target = socketForHostUrl(targetUrl)
  return { queued: !target?.connected }
}

export function emitVoiceUdpAudio(roomId: string, meta: unknown, payload: unknown): void {
  if (!currentUserId) return
  const targetUrl = voiceUdpTargetUrl(roomId)
  if (!targetUrl) return
  if (rejectIncompatibleHost(targetUrl)) return
  voiceUdp.configureHost(targetUrl, currentUserId)
  voiceUdp.sendAudio(targetUrl, roomId, meta, payload)
}

export function emitVoiceUdpPing(roomId: string, sentAt: number): void {
  if (!currentUserId) return
  const targetUrl = voiceUdpTargetUrl(roomId)
  if (!targetUrl) return
  if (rejectIncompatibleHost(targetUrl)) return
  voiceUdp.configureHost(targetUrl, currentUserId)
  voiceUdp.sendPing(targetUrl, roomId, sentAt)
}

export function isConnected(): boolean {
  return Boolean(
    (socket?.connected && isHostUsable(currentUrl)) ||
    [...secondaryHosts.entries()].some(([url, candidate]) => candidate.connected && isHostUsable(url))
  )
}

export function getSocketId(): string | null {
  return socket?.id ?? null
}
