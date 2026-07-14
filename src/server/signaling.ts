/**
 * MESH signaling server.
 *
 * Historically run as a separate process (`npm run signaling`), but is now
 * primarily embedded inside the Electron main process — see `startSignalingServer`.
 * The CLI entrypoint at the bottom of this file is kept only for development.
 */

import express from 'express'
import { createServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import dgram, { type RemoteInfo } from 'dgram'
import fs from 'fs'
import path from 'path'
import { PERM, MODERATOR_BUNDLE } from '../shared/permissions'
import { decodeVoiceUdpPacket, encodeVoiceUdpPacket } from '../shared/voice-udp-packet'

export interface SignalingInstance {
  /** Bind and start listening. Resolves once the port is open. */
  start: () => Promise<{ port: number }>
  /** Close the socket server + underlying http listener. */
  stop: () => Promise<void>
  isRunning: () => boolean
  readonly port: number
}

/**
 * Create an INDEPENDENT signaling server bound to `instancePort`.
 *
 * Each instance owns its own socket.io server, relay registry, presence,
 * community-server registry, voice rooms and offline queue. Nothing is
 * shared between instances — so one machine can host several isolated MESH
 * networks on different ports simultaneously (multi-hosting). Previously
 * every piece of state lived at module scope, which capped the machine at a
 * single host port.
 */
export function createSignalingInstance(instancePort: number): SignalingInstance {
const app = express()
const httpServer = createServer(app)
// maxHttpBufferSize: socket.io's default is 1MB and it DISCONNECTS a client
// whose message exceeds it — base64 file payloads (DM fallback + server
// attachments, ≤2MB raw ≈ 2.7MB encoded) silently killed the socket.
const io = new SocketServer(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 8 * 1024 * 1024
})

// ── Relay Registry ──

interface RelayEntry {
  id: string
  address: string
  scope: 'isp-local' | 'global'
  credentials: { username: string; password: string } | null
  lastHeartbeat: number
  users: number
}

const relays = new Map<string, RelayEntry>()

app.use(express.json())

app.post('/register-relay', (req, res) => {
  const { address, scope, credentials } = req.body as {
    address?: string
    scope?: 'isp-local' | 'global'
    credentials?: { username: string; password: string } | null
  }
  if (!address || typeof address !== 'string') {
    res.status(400).json({ error: 'address required' })
    return
  }
  // The SERVER generates the id and returns it — the old contract read `id`
  // from the request (which clients never sent, keying every relay under
  // `undefined`) and returned `{ok:true}` (so clients stored id undefined).
  // Credentials are stored too: node-turn runs long-term auth, and a TURN
  // url without username/password is a silent no-op for every client.
  const id = `relay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  relays.set(id, {
    id,
    address,
    scope: scope === 'global' ? 'global' : 'isp-local',
    credentials: credentials ?? null,
    lastHeartbeat: Date.now(),
    users: 0
  })
  console.log(`[relay] registered: ${id} @ ${address} (${scope})`)
  res.json({ id })
})

app.post('/deregister-relay', (req, res) => {
  const { id } = req.body
  relays.delete(id)
  console.log(`[relay] deregistered: ${id}`)
  res.json({ ok: true })
})

app.get('/get-relays', (_req, res) => {
  const active = [...relays.values()].filter((r) => Date.now() - r.lastHeartbeat < 60000)
  res.json(active)
})

app.post('/heartbeat-relay', (req, res) => {
  const relay = relays.get(req.body.id)
  if (relay) {
    relay.lastHeartbeat = Date.now()
    relay.users = req.body.users || 0
  }
  res.json({ ok: true })
})

// Auto-expire stale relays every 30s
setInterval(() => {
  const now = Date.now()
  for (const [id, relay] of relays) {
    if (now - relay.lastHeartbeat > 60000) {
      relays.delete(id)
      console.log(`[relay] expired: ${id}`)
    }
  }
}, 30000)

// ── Socket.io Signaling ──

// Track every live socket for a user. A single app can legitimately have more
// than one connection to the same host (primary, secondary, hosted-route helper).
// Social delivery must hit all of them so events do not disappear into a helper
// socket that was opened only for server routing.
const userSockets = new Map<string, Set<string>>()

function addUserSocket(userId: string, socketId: string): void {
  let sockets = userSockets.get(userId)
  if (!sockets) {
    sockets = new Set()
    userSockets.set(userId, sockets)
  }
  sockets.add(socketId)
}

function removeUserSocket(userId: string, socketId: string): boolean {
  const sockets = userSockets.get(userId)
  if (!sockets) return false
  sockets.delete(socketId)
  if (sockets.size === 0) {
    userSockets.delete(userId)
    return false
  }
  return true
}

function liveSocketIdsForUser(userId: string): string[] {
  const sockets = userSockets.get(userId)
  if (!sockets) return []
  const live: string[] = []
  for (const socketId of sockets) {
    if (io.sockets.sockets.has(socketId)) live.push(socketId)
    else sockets.delete(socketId)
  }
  if (sockets.size === 0) userSockets.delete(userId)
  return live
}

function hasLiveUserSocket(userId: string): boolean {
  return liveSocketIdsForUser(userId).length > 0
}

function firstLiveUserSocketId(userId: string): string | null {
  return liveSocketIdsForUser(userId)[0] ?? null
}

function emitToUser(userId: string, event: string, ...args: unknown[]): boolean {
  const liveSocketIds = liveSocketIdsForUser(userId)
  const socialSocketIds = liveSocketIds.filter((socketId) => {
    const target = io.sockets.sockets.get(socketId)
    return target?.data.connectionRole !== 'auxiliary'
  })
  const socketIds = socialSocketIds.length > 0 ? socialSocketIds : liveSocketIds
  for (const socketId of socketIds) {
    io.to(socketId).emit(event, ...args)
  }
  return socketIds.length > 0
}

// ── Presence Registry (Task 4 — discovery) ──
interface PresenceEntry {
  userId: string
  username: string
  avatarColor: string | null
  hidden: boolean
}
const presence = new Map<string, PresenceEntry>()

// ── Status (Task 6 — online/idle/offline) ──
type StatusValue = 'online' | 'idle' | 'offline'
interface StatusEntry {
  status: StatusValue
  invisible: boolean
  lastSeen: number
}
const statusMap = new Map<string, StatusEntry>() // userId → status
// For each userId, the set of other users who observe their status (= those who have them as a friend).
const observedBy = new Map<string, Set<string>>()
// Per-socket snapshot of the friends this socket subscribed to (for cleanup on disconnect).
const socketFriendSubs = new Map<string, Set<string>>()

function effectiveStatus(e: StatusEntry | undefined): StatusValue {
  if (!e) return 'offline'
  if (e.invisible) return 'offline'
  return e.status
}

function notifyObservers(userId: string): void {
  const obs = observedBy.get(userId)
  if (!obs || obs.size === 0) return
  const entry = statusMap.get(userId)
  const payload = {
    userId,
    status: effectiveStatus(entry),
    lastSeen: entry?.lastSeen ?? Date.now()
  }
  for (const observerId of obs) {
    emitToUser(observerId, 'status:changed', payload)
  }
}

// ── Community Servers ──
interface ServerMemberInfo {
  userId: string
  username: string
  avatarColor: string | null
  role: 'host' | 'moderator' | 'member'
  isMuted: boolean
  /** Custom role ids assigned by the host. */
  roleIds?: string[]
}
interface ServerEntry {
  id: string
  name: string
  iconColor: string
  avatarDataUrl?: string | null
  textChannelName: string
  voiceRoomName: string
  hostUserId: string
  hostUsername: string
  hostAvatarColor: string | null
  hostSocketId: string | null
  members: Map<string, ServerMemberInfo>
  banned: Set<string>
  passwordHash?: string | null
  /** Host's authoritative channel layout (categories + channels), opaque here. */
  layout: unknown | null
  /** Custom display names for the role tiers ({host,moderator,member}). */
  roleNames: { host?: string; moderator?: string; member?: string } | null
  /** Host's custom role definitions (Discord-style), opaque here. */
  roles: unknown | null
  /** Recently accepted client message ids make resend-after-reconnect safe. */
  acceptedMessageIds: Map<string, number>
}
const servers = new Map<string, ServerEntry>()

app.get('/get-servers', (_req, res) => {
  const active = [...servers.values()]
    .filter((entry) => hasLiveUserSocket(entry.hostUserId))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      iconColor: entry.iconColor,
      avatarDataUrl: entry.avatarDataUrl ?? null,
      textChannelName: entry.textChannelName,
      voiceRoomName: entry.voiceRoomName,
      hostUserId: entry.hostUserId,
      hostUsername: entry.hostUsername,
      hostAvatarColor: entry.hostAvatarColor,
      memberCount: entry.members.size,
      onlineMemberCount: [...entry.members.keys()].filter((id) => hasLiveUserSocket(id)).length,
      requiresPassword: Boolean(entry.passwordHash)
    }))
  res.json(active)
})

function roomName(serverId: string): string {
  return `server:${serverId}`
}

function serialiseMembers(entry: ServerEntry): ServerMemberInfo[] {
  return Array.from(entry.members.values())
}

// Offline queue: events delivered when user reconnects.
interface QueuedEvent {
  event: string
  args: unknown[]
}

// Queue persistence location: inside Electron use userData (cwd is the
// read-only install directory in packaged builds, where writes silently
// fail); standalone CLI mode falls back to cwd.
function resolveQueueFile(): string {
  // Per-port filename so simultaneous host instances never share a queue.
  const fileName = `offline_queue_${instancePort}.json`
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { getPath: (name: string) => string } }
    if (electron?.app?.getPath) {
      return path.join(electron.app.getPath('userData'), fileName)
    }
  } catch { /* not running inside Electron */ }
  return path.join(process.cwd(), fileName)
}
const QUEUE_FILE = resolveQueueFile()
let offlineQueue = new Map<string, QueuedEvent[]>()

try {
  if (fs.existsSync(QUEUE_FILE)) {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    offlineQueue = new Map(Object.entries(parsed))
  }
} catch (e) {
  console.error('[queue] failed to load offline queue:', e)
}

// Serialised write queue.
//
// Concurrent `saveQueueAsync()` callers previously raced each other on
// `fs.writeFile`, producing interleaved JSON and corrupted queue files
// under bursty loads (many deliverOrQueue calls at once). This mutex
// guarantees at most one in-flight writeFile; any subsequent calls
// collapse into the single `pendingWrite` slot so we always persist the
// latest snapshot without a stack of wasted writes.
let writing = false
let pendingWrite: string | null = null

async function saveQueueAsync(): Promise<void> {
  pendingWrite = JSON.stringify(Object.fromEntries(offlineQueue))
  if (writing) return
  writing = true
  try {
    while (pendingWrite !== null) {
      const toWrite = pendingWrite
      pendingWrite = null
      try {
        await fs.promises.writeFile(QUEUE_FILE, toWrite, 'utf8')
      } catch (err) {
        console.error('[queue] failed to persist offline queue:', err)
      }
    }
  } finally {
    writing = false
  }
}

// ── Voice-room participant tracking ──
//
// Maps each `voice:<serverId>[:<channelId>]` room to the set of userIds
// currently in it, with the socketId that holds each membership. On a
// new join we evict any stale socket for the same userId — that is the
// fix for ghost entries after a host disconnect+reconnect race: the old
// socket's disconnect handler may fire after the new socket has already
// joined, so without dedupe the client's participant list sees the same
// user twice and the eviction of the old socket later removes the user
// entirely.
const voiceRoomMembers = new Map<string, Map<string, string>>() // roomId → (userId → socketId)
// Per-socket set of voice rooms this socket currently belongs to, so
// disconnect can clean up every room this socket was in (not just the
// last-joined `socket.data.roomId`).
const socketVoiceRooms = new Map<string, Set<string>>() // socketId → Set<roomId>
const activeVoiceStreams = new Map<string, Map<string, { kind?: 'screen' | 'window' | 'camera'; paused?: boolean }>>() // roomId → userId → stream info

interface VoiceUdpEndpoint {
  address: string
  port: number
  lastSeen: number
}

const voiceUdpEndpoints = new Map<string, VoiceUdpEndpoint>()
let voiceUdpSocket: dgram.Socket | null = null
let voiceUdpCleanupTimer: ReturnType<typeof setInterval> | null = null

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function headerObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function rememberVoiceUdpEndpoint(userId: string, rinfo: RemoteInfo): void {
  voiceUdpEndpoints.set(userId, {
    address: rinfo.address,
    port: rinfo.port,
    lastSeen: Date.now()
  })
}

function pruneVoiceUdpEndpoints(): void {
  const now = Date.now()
  for (const [userId, endpoint] of voiceUdpEndpoints) {
    if (!hasLiveUserSocket(userId) || now - endpoint.lastSeen > 30000) {
      voiceUdpEndpoints.delete(userId)
    }
  }
}

function sendVoiceUdpPacket(endpoint: VoiceUdpEndpoint, packet: Uint8Array): void {
  const sock = voiceUdpSocket
  if (!sock) return
  sock.send(packet, endpoint.port, endpoint.address, (err) => {
    if (err) console.warn(`[voice-udp:${instancePort}] send failed:`, err.message)
  })
}

function relayVoiceUdpAudio(header: Record<string, unknown>, payload: Uint8Array, rinfo: RemoteInfo): void {
  const roomId = asNonEmptyString(header.roomId)
  const userId = asNonEmptyString(header.userId)
  if (!roomId || !userId || !hasLiveUserSocket(userId)) return
  const members = voiceRoomMembers.get(roomId)
  if (!members?.has(userId)) return

  rememberVoiceUdpEndpoint(userId, rinfo)
  const out = encodeVoiceUdpPacket('audio', {
    roomId,
    fromUserId: userId,
    meta: headerObject(header.meta)
  }, payload)

  for (const memberUserId of members.keys()) {
    if (memberUserId === userId) continue
    const endpoint = voiceUdpEndpoints.get(memberUserId)
    if (endpoint) sendVoiceUdpPacket(endpoint, out)
  }
}

function handleVoiceUdpMessage(message: Buffer, rinfo: RemoteInfo): void {
  const packet = decodeVoiceUdpPacket(message)
  if (!packet) return

  if (packet.kind === 'ping') {
    const userId = asNonEmptyString(packet.header.userId)
    const roomId = asNonEmptyString(packet.header.roomId)
    if (!userId || !roomId || !hasLiveUserSocket(userId)) return
    const members = voiceRoomMembers.get(roomId)
    if (!members?.has(userId)) return
    rememberVoiceUdpEndpoint(userId, rinfo)
    const sentAt = typeof packet.header.sentAt === 'number' ? packet.header.sentAt : 0
    const endpoint = voiceUdpEndpoints.get(userId)
    if (endpoint) {
      sendVoiceUdpPacket(endpoint, encodeVoiceUdpPacket('pong', {
        roomId,
        userId,
        sentAt
      }))
    }
    return
  }

  if (packet.kind === 'audio') {
    relayVoiceUdpAudio(packet.header, packet.payload, rinfo)
  }
}

function parseVoiceRoom(roomId: string): { serverId: string; channelId: string } | null {
  if (!roomId.startsWith('voice:')) return null
  const parts = roomId.split(':')
  if (parts.length < 2) return null
  return { serverId: parts[1], channelId: parts.length > 2 ? parts[2] : 'legacy' }
}

function replayActiveStreamsToSocket(roomId: string, socketId: string, joiningUserId: string): void {
  const voice = parseVoiceRoom(roomId)
  const streams = activeVoiceStreams.get(roomId)
  if (!voice || !streams || streams.size === 0) return
  for (const [userId, info] of streams) {
    if (userId === joiningUserId) continue
    io.to(socketId).emit('server:stream-start', {
      serverId: voice.serverId,
      channelId: voice.channelId,
      userId,
      kind: info.kind,
      paused: !!info.paused
    })
  }
}

function clearActiveStream(roomId: string, userId: string): void {
  const streams = activeVoiceStreams.get(roomId)
  if (!streams?.has(userId)) return
  streams.delete(userId)
  if (streams.size === 0) activeVoiceStreams.delete(roomId)
  const voice = parseVoiceRoom(roomId)
  if (voice) {
    io.to(roomName(voice.serverId)).emit('server:stream-stop', {
      serverId: voice.serverId,
      channelId: voice.channelId,
      userId
    })
  }
}

function activeVoiceRoomForSocket(socketId: string, serverId: string): { roomId: string; channelId: string } | null {
  const rooms = socketVoiceRooms.get(socketId)
  if (!rooms) return null
  for (const roomId of rooms) {
    const voice = parseVoiceRoom(roomId)
    if (voice?.serverId === serverId) return { roomId, channelId: voice.channelId }
  }
  return null
}

/**
 * Resolve a user's display name/color for voice payloads. The server member
 * roster is authoritative; fall back to global presence, then to null so the
 * client can render a placeholder. Carrying identity in the voice events means
 * clients never have to race a separate roster sync (which produced the
 * "Peer usr_xxxx" placeholder + name-flicker bug).
 */
function identityFor(serverId: string, userId: string): { username: string | null; avatarColor: string | null } {
  const member = servers.get(serverId)?.members.get(userId)
  if (member) return { username: member.username, avatarColor: member.avatarColor }
  const p = presence.get(userId)
  if (p) return { username: p.username, avatarColor: p.avatarColor }
  return { username: null, avatarColor: null }
}

/**
 * Authoritative snapshot of who is in which voice channel for a server, with
 * identity attached. Used to bring a freshly-subscribed client in sync — the
 * live voice-joined/voice-left deltas only cover changes AFTER you subscribe,
 * so without this snapshot a later-joiner never sees people already sitting in
 * a channel (the "one side sees the other but not vice-versa" bug).
 */
function voiceOccupantsForServer(serverId: string): Array<{
  userId: string
  channelId: string
  username: string | null
  avatarColor: string | null
}> {
  const out: Array<{ userId: string; channelId: string; username: string | null; avatarColor: string | null }> = []
  for (const [roomId, members] of voiceRoomMembers) {
    const voice = parseVoiceRoom(roomId)
    if (!voice || voice.serverId !== serverId) continue
    for (const userId of members.keys()) {
      const id = identityFor(serverId, userId)
      out.push({ userId, channelId: voice.channelId, username: id.username, avatarColor: id.avatarColor })
    }
  }
  return out
}

/**
 * Register a socket as the live holder of a user's voice-room seat.
 * If another socket is already holding the seat for this userId, it is
 * kicked out first — both from our tracking map and from the underlying
 * Socket.IO room — and a voice-left is broadcast so clients can drop the
 * old entry BEFORE we emit the new voice-joined.
 */
function registerVoiceMember(roomId: string, userId: string, socketId: string): void {
  const parsedNew = parseVoiceRoom(roomId)
  if (parsedNew) {
    // Evict this userId from ANY other voice room of the same server —
    // fixes ghost users when a member hops channels and the new join
    // lands before the old leave resolves for remote peers.
    for (const [otherRoomId, otherMembers] of voiceRoomMembers) {
      if (otherRoomId === roomId) continue
      const parsedOther = parseVoiceRoom(otherRoomId)
      if (!parsedOther || parsedOther.serverId !== parsedNew.serverId) continue
      const staleSocketId = otherMembers.get(userId)
      if (!staleSocketId) continue
      otherMembers.delete(userId)
      if (otherMembers.size === 0) voiceRoomMembers.delete(otherRoomId)
      socketVoiceRooms.get(staleSocketId)?.delete(otherRoomId)
      const staleSocket = io.sockets.sockets.get(staleSocketId)
      if (staleSocket) staleSocket.leave(otherRoomId)
      clearActiveStream(otherRoomId, userId)
      io.to(roomName(parsedOther.serverId)).emit('server:voice-left', {
        userId,
        serverId: parsedOther.serverId
      })
    }
  }
  let members = voiceRoomMembers.get(roomId)
  if (!members) {
    members = new Map()
    voiceRoomMembers.set(roomId, members)
  }
  const existingSocketId = members.get(userId)
  if (existingSocketId && existingSocketId !== socketId) {
    // Evict the stale socket. It may already be gone (race during reconnect)
    // but we still clean tracking + emit voice-left so clients reconcile.
    const oldSocket = io.sockets.sockets.get(existingSocketId)
    if (oldSocket) {
      oldSocket.leave(roomId)
      socketVoiceRooms.get(existingSocketId)?.delete(roomId)
    }
    const parsed = parseVoiceRoom(roomId)
    if (parsed) {
      clearActiveStream(roomId, userId)
      io.to(roomName(parsed.serverId)).emit('server:voice-left', {
        userId,
        serverId: parsed.serverId
      })
    }
  }
  members.set(userId, socketId)
  let set = socketVoiceRooms.get(socketId)
  if (!set) {
    set = new Set()
    socketVoiceRooms.set(socketId, set)
  }
  set.add(roomId)
}

/** Unregister this socket's seat in a voice room. Returns true if it held one. */
function unregisterVoiceMember(roomId: string, userId: string, socketId: string): boolean {
  const members = voiceRoomMembers.get(roomId)
  if (!members) return false
  // Only remove if this socket still owns the seat — avoids yanking a
  // freshly-reconnected socket's valid entry when an old disconnect lands late.
  if (members.get(userId) !== socketId) {
    socketVoiceRooms.get(socketId)?.delete(roomId)
    return false
  }
  members.delete(userId)
  if (members.size === 0) voiceRoomMembers.delete(roomId)
  socketVoiceRooms.get(socketId)?.delete(roomId)
  return true
}

const recentSocialEventIds = new Map<string, number>()

function acceptSocialEventOnce(kind: string, id: unknown): boolean {
  if (typeof id !== 'string' || id.trim().length === 0) return true
  const now = Date.now()
  for (const [key, seenAt] of recentSocialEventIds) {
    if (now - seenAt > 60000) recentSocialEventIds.delete(key)
  }
  const key = `${kind}:${id}`
  if (recentSocialEventIds.has(key)) return false
  recentSocialEventIds.set(key, now)
  return true
}

function deliverOrQueue(targetUserId: string, event: string, ...args: unknown[]): void {
  if (!emitToUser(targetUserId, event, ...args)) {
    const q = offlineQueue.get(targetUserId) ?? []
    q.push({ event, args })
    offlineQueue.set(targetUserId, q)
    saveQueueAsync()
  }
}

function flushQueue(userId: string, socketId: string): void {
  const q = offlineQueue.get(userId)
  if (!q || q.length === 0) return
  for (const { event, args } of q) {
    io.to(socketId).emit(event, ...args)
  }
  offlineQueue.delete(userId)
  saveQueueAsync()
  console.log(`[queue] flushed ${q.length} events to ${userId}`)
}

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`)
  socket.data.connectionRole = 'primary'

  socket.on('register-user', (userId: string) => {
    if (socket.data.userId && socket.data.userId !== userId) {
      removeUserSocket(socket.data.userId, socket.id)
    }
    socket.data.userId = userId
    addUserSocket(userId, socket.id)
    console.log(`[socket] user registered: ${userId} -> ${socket.id}`)
    flushQueue(userId, socket.id)
  })

  socket.on('connection-role', (role: unknown) => {
    socket.data.connectionRole = role === 'auxiliary' || role === 'secondary'
      ? role
      : 'primary'
  })

  // ── Presence / Discovery (Task 4) ──
  socket.on('presence:update', (payload: { username: string; avatarColor: string | null; hidden: boolean }) => {
    const userId = socket.data.userId as string | undefined
    if (!userId) return
    const entry: PresenceEntry = {
      userId,
      username: payload.username,
      avatarColor: payload.avatarColor,
      hidden: !!payload.hidden
    }
    presence.set(userId, entry)
    // Tell everyone about this user (they now see us).
    io.emit('presence:changed', entry)
    // AND push the full current roster back to us, so announcing ourselves
    // also makes us see everyone already present. This makes discovery
    // symmetric without depending on the fragile presence:list ack — the
    // previous cause of "they saw me but I couldn't see them".
    const snapshot = [...presence.values()]
      .filter((e) => !e.hidden && e.userId !== userId)
      .map((e) => ({ userId: e.userId, username: e.username, avatarColor: e.avatarColor }))
    socket.emit('presence:snapshot', snapshot)
  })

  // ── Status (Task 6) ──
  socket.on('status:set-friends', (friendIds: string[]) => {
    const userId = socket.data.userId as string | undefined
    if (!userId) return
    const prev = socketFriendSubs.get(socket.id) || new Set<string>()
    // Remove self from observer sets that are no longer in the list.
    for (const fid of prev) {
      if (!friendIds.includes(fid)) {
        observedBy.get(fid)?.delete(userId)
      }
    }
    const next = new Set<string>(friendIds)
    for (const fid of next) {
      if (!observedBy.has(fid)) observedBy.set(fid, new Set())
      observedBy.get(fid)!.add(userId)
    }
    socketFriendSubs.set(socket.id, next)
    // Send the caller the current statuses of the friends they subscribed to.
    const snapshot = friendIds.map((fid) => {
      const e = statusMap.get(fid)
      return { userId: fid, status: effectiveStatus(e), lastSeen: e?.lastSeen ?? 0 }
    })
    socket.emit('status:snapshot', snapshot)
  })

  socket.on('status:update', (payload: { status: StatusValue; invisible?: boolean }) => {
    const userId = socket.data.userId as string | undefined
    if (!userId) return
    const entry: StatusEntry = {
      status: payload.status,
      invisible: !!payload.invisible,
      lastSeen: Date.now()
    }
    statusMap.set(userId, entry)
    notifyObservers(userId)
  })

  socket.on('presence:list', (ack: (list: Array<{ userId: string; username: string; avatarColor: string | null }>) => void) => {
    const selfId = socket.data.userId as string | undefined
    const out: Array<{ userId: string; username: string; avatarColor: string | null }> = []
    for (const e of presence.values()) {
      if (e.hidden) continue
      if (e.userId === selfId) continue
      out.push({ userId: e.userId, username: e.username, avatarColor: e.avatarColor })
    }
    if (typeof ack === 'function') ack(out)
  })

  // ── Friend requests ──
  // Payload: { id, fromUserId, fromUsername, fromAvatarColor, toUserId, timestamp }
  socket.on('friend-request:send', (payload: { id: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string; timestamp: number }) => {
    if (!acceptSocialEventOnce('friend-request:send', payload.id)) return
    deliverOrQueue(payload.toUserId, 'friend-request:incoming', payload)
  })

  // Payload: { requestId, fromUserId (accepter), fromUsername, fromAvatarColor, toUserId (original sender) }
  socket.on('friend-request:accept', (payload: { requestId: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string }) => {
    if (!acceptSocialEventOnce('friend-request:accept', payload.requestId)) return
    deliverOrQueue(payload.toUserId, 'friend-request:accepted', payload)
  })

  // Payload: { requestId, fromUserId (rejecter), toUserId (original sender) }
  socket.on('friend-request:reject', (payload: { requestId: string; fromUserId: string; toUserId: string }) => {
    if (!acceptSocialEventOnce('friend-request:reject', payload.requestId)) return
    deliverOrQueue(payload.toUserId, 'friend-request:rejected', payload)
  })

  // Payload: { requestId, fromUserId (canceller = original sender), toUserId (recipient) }
  socket.on('friend-request:cancel', (payload: { requestId: string; fromUserId: string; toUserId: string }) => {
    if (!acceptSocialEventOnce('friend-request:cancel', payload.requestId)) return
    deliverOrQueue(payload.toUserId, 'friend-request:cancelled', payload)
  })

  // ── Message requests ──
  // Cold first-message. Payload carries a message + sender identity.
  socket.on('message-request:send', (payload: {
    requestId: string
    messageId: string
    fromUserId: string
    fromUsername: string
    fromAvatarColor: string | null
    toUserId: string
    content: string
    timestamp: number
  }) => {
    if (!acceptSocialEventOnce('message-request:send', payload.messageId)) return
    deliverOrQueue(payload.toUserId, 'message-request:incoming', payload)
  })

  // Message inside an existing request thread (either direction).
  socket.on('message-request:message', (payload: {
    messageId: string
    fromUserId: string
    fromUsername: string
    toUserId: string
    content: string
    timestamp: number
    isReply: boolean
  }) => {
    if (!acceptSocialEventOnce('message-request:message', payload.messageId)) return
    deliverOrQueue(payload.toUserId, 'message-request:message-incoming', payload)
  })

  // ── Community Servers ──

  // Host registers (or re-registers) their server on the signaling network.
  socket.on('server:register', (payload: {
    serverId: string
    name: string
    iconColor: string
    avatarDataUrl?: string | null
    textChannelName: string
    voiceRoomName: string
    hostUserId: string
    hostUsername: string
    hostAvatarColor: string | null
    members: ServerMemberInfo[]
    banned: string[]
    passwordHash?: string | null
    layout?: unknown | null
    roleNames?: { host?: string; moderator?: string; member?: string } | null
    roles?: unknown | null
  }) => {
    let entry = servers.get(payload.serverId)
    if (!entry) {
      entry = {
        id: payload.serverId,
        name: payload.name,
        iconColor: payload.iconColor,
        avatarDataUrl: payload.avatarDataUrl ?? null,
        textChannelName: payload.textChannelName,
        voiceRoomName: payload.voiceRoomName,
        hostUserId: payload.hostUserId,
        hostUsername: payload.hostUsername,
        hostAvatarColor: payload.hostAvatarColor,
        hostSocketId: socket.id,
        members: new Map(),
        banned: new Set(payload.banned),
        passwordHash: payload.passwordHash,
        layout: payload.layout ?? null,
        roleNames: payload.roleNames ?? null,
        roles: payload.roles ?? null,
        acceptedMessageIds: new Map()
      }
      servers.set(payload.serverId, entry)
      console.log(`[server] registered: ${payload.serverId} by ${payload.hostUserId}`)
    } else {
      // Only update if hostSocketId changed (prevents spam logs)
      if (entry.hostSocketId !== socket.id) {
        entry.hostSocketId = socket.id
        console.log(`[server] re-registered: ${payload.serverId} by ${payload.hostUserId}`)
      }
      entry.banned = new Set(payload.banned)
      if (payload.avatarDataUrl !== undefined) entry.avatarDataUrl = payload.avatarDataUrl ?? null
      if (payload.layout !== undefined) entry.layout = payload.layout
      if (payload.roleNames !== undefined) entry.roleNames = payload.roleNames ?? null
      if (payload.roles !== undefined) entry.roles = payload.roles ?? null
    }
    // Reset member list with host authoritative snapshot
    entry.members.clear()
    for (const m of payload.members) entry.members.set(m.userId, m)
    socket.join(roomName(payload.serverId))
    // Sync the (re)connecting host with any voice occupants that persisted
    // across the reconnect.
    socket.emit('server:voice-occupants', {
      serverId: entry.id,
      occupants: voiceOccupantsForServer(entry.id)
    })
    // Share the host's channel layout with current members so custom
    // channels (and their role gates) exist on every client, not just the
    // host's machine.
    if (entry.layout) {
      socket.to(roomName(payload.serverId)).emit('server:layout', { serverId: entry.id, layout: entry.layout })
    }
    // Tell everyone the host is (back) online so members whose auto-rejoin
    // raced ahead of this re-register can silently join now. Without this,
    // a member denied with "Host is currently offline" never retried and
    // received no server events until an app restart.
    io.emit('server:host-online', { serverId: payload.serverId })
  })

  socket.on('server:unregister', (payload: { serverId: string }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    const userId = socket.data.userId as string | undefined
    if (entry.hostSocketId !== socket.id && entry.hostUserId !== userId) return
    servers.delete(payload.serverId)
    socket.leave(roomName(payload.serverId))
    io.to(roomName(payload.serverId)).emit('server:error', {
      serverId: payload.serverId,
      reason: 'Host moved this server to another port.'
    })
    console.log(`[server] unregistered: ${payload.serverId}`)
  })

  /** Is this socket a member with the given permission (host always passes)? */
  function socketPermitted(entry: ServerEntry, perm: number): boolean {
    const userId = socket.data.userId as string | undefined
    if (!userId) return false
    if (userId === entry.hostUserId) return true
    const actor = entry.members.get(userId)
    if (!actor) return false
    if (actor.role === 'host') return true
    let mask = 0
    if (actor.role === 'moderator') mask |= MODERATOR_BUNDLE
    const roleDefs = Array.isArray(entry.roles)
      ? (entry.roles as Array<{ id?: string; permissions?: number }>)
      : []
    const ids = actor.roleIds ?? []
    for (const r of roleDefs) {
      if (r?.id && ids.includes(r.id)) mask |= r.permissions ?? 0
    }
    return (mask & perm) === perm
  }

  // Channel layout changed. Anyone with Manage Channels may push — the old
  // host-socket-only guard silently dropped changes made by permitted
  // moderators, so their edits never reached other members.
  socket.on('server:layout-update', (payload: { serverId: string; layout: unknown }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    if (!socketPermitted(entry, PERM.manageChannels)) return
    entry.layout = payload.layout
    socket.to(roomName(payload.serverId)).emit('server:layout', { serverId: entry.id, layout: entry.layout })
  })

  // Role tier names changed (e.g. Host/Moderator/Member → CEO/Lead/Staff).
  socket.on('server:role-names-update', (payload: {
    serverId: string
    roleNames: { host?: string; moderator?: string; member?: string } | null
  }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    if (!socketPermitted(entry, PERM.manageServer)) return
    entry.roleNames = payload.roleNames ?? null
    socket.to(roomName(payload.serverId)).emit('server:role-names', { serverId: entry.id, roleNames: entry.roleNames })
  })

  // Custom role definitions changed (create/edit/delete).
  socket.on('server:roles-update', (payload: { serverId: string; roles: unknown }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    if (!socketPermitted(entry, PERM.manageRoles)) return
    entry.roles = payload.roles ?? null
    socket.to(roomName(payload.serverId)).emit('server:roles', { serverId: entry.id, roles: entry.roles })
  })

  // Custom roles were assigned to / removed from a member.
  socket.on('server:member-roles-update', (payload: { serverId: string; userId: string; roleIds: string[] }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    if (!socketPermitted(entry, PERM.manageRoles)) return
    const member = entry.members.get(payload.userId)
    if (member) member.roleIds = Array.isArray(payload.roleIds) ? payload.roleIds : []
    io.to(roomName(payload.serverId)).emit('server:member-roles', {
      serverId: entry.id,
      userId: payload.userId,
      roleIds: Array.isArray(payload.roleIds) ? payload.roleIds : []
    })
  })

  // Member requests to join. We validate + broadcast + send state to joiner.
  socket.on('server:join', (payload: {
    serverId: string
    userId: string
    username: string
    avatarColor: string | null
    passwordHash?: string | null
  }) => {
    const entry = servers.get(payload.serverId)
    // A missing entry means the host isn't currently online — in MESH, the
    // host IS the server (P2P), so when the host's socket disconnects the
    // entry is deleted from `servers`. We reply immediately with a friendly
    // reason so the UI doesn't sit on a 15-second spinner waiting for a
    // server that will never respond.
    if (!entry) {
      socket.emit('server:join-denied', {
        serverId: payload.serverId,
        reason: 'Host is currently offline. The server will be available when the host opens MESH.'
      })
      return
    }
    // Host online check: resolve the server's hostUserId, then ask the
    // authoritative live-user map (`userSockets`) whether any socket is
    // currently registered for that userId. The previous implementation
    // checked `entry.hostSocketId` against `io.sockets.sockets.get(...)`,
    // but `hostSocketId` is only refreshed on `server:register`. If the
    // host briefly reconnected and hadn't re-registered yet, the stored
    // id pointed to a dead socket even though the user was actively online
    // — producing a false "Host offline" for people trying to join.
    const hostSocketId = firstLiveUserSocketId(entry.hostUserId)
    const hostSocket = hostSocketId ? io.sockets.sockets.get(hostSocketId) : null
    if (!hostSocket) {
      socket.emit('server:join-denied', {
        serverId: payload.serverId,
        reason: 'Host is currently offline. The server will be available when the host opens MESH.'
      })
      return
    }
    // Self-heal stale `hostSocketId` so subsequent events (messages,
    // broadcasts) route to the live socket without waiting for a
    // re-register. Safe because hostUserId ownership is verified above.
    if (entry.hostSocketId !== hostSocketId) {
      entry.hostSocketId = hostSocketId
    }
    if (entry.banned.has(payload.userId)) {
      socket.emit('server:join-denied', { serverId: payload.serverId, reason: 'You are banned from this server.' })
      return
    }
    // Existing members (present in the host's authoritative snapshot) skip
    // the password check — they were already admitted once. Without this,
    // members could never auto-rejoin a password server after a reconnect
    // because clients don't retain the hash they joined with.
    const alreadyMember = entry.members.has(payload.userId)
    if (!alreadyMember && entry.passwordHash && entry.passwordHash !== payload.passwordHash) {
      socket.emit('server:join-denied', { serverId: payload.serverId, reason: 'Incorrect password.' })
      return
    }
    const isHost = payload.userId === entry.hostUserId
    const existing = entry.members.get(payload.userId)
    const member: ServerMemberInfo = existing ?? {
      userId: payload.userId,
      username: payload.username,
      avatarColor: payload.avatarColor,
      role: isHost ? 'host' : 'member',
      isMuted: false
    }
    entry.members.set(payload.userId, member)
    socket.join(roomName(payload.serverId))

    // Bring the joiner in sync with who's already sitting in voice channels.
    // The live voice-joined deltas only cover changes from here on, so without
    // this snapshot a later-joiner never sees existing occupants.
    socket.emit('server:voice-occupants', {
      serverId: entry.id,
      occupants: voiceOccupantsForServer(entry.id)
    })

    // Send joiner the current state. `onlineUserIds` is computed from the
    // live socket registry — the members list is a roster snapshot and its
    // `status` fields must never be used for presence dots.
    socket.emit('server:join-ack', {
      serverId: entry.id,
      name: entry.name,
      iconColor: entry.iconColor,
      avatarDataUrl: entry.avatarDataUrl ?? null,
      textChannelName: entry.textChannelName,
      voiceRoomName: entry.voiceRoomName,
      hostUserId: entry.hostUserId,
      hostUsername: entry.hostUsername,
      hostAvatarColor: entry.hostAvatarColor,
      members: serialiseMembers(entry),
      onlineUserIds: [...entry.members.keys()].filter((id) => hasLiveUserSocket(id)),
      layout: entry.layout,
      roleNames: entry.roleNames,
      roles: entry.roles,
      yourRole: member.role
    })
    // Broadcast to room that a new member joined.
    socket.to(roomName(payload.serverId)).emit('server:member-joined', { serverId: entry.id, member })
  })

  socket.on('server:leave', (payload: { serverId: string; userId: string }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    entry.members.delete(payload.userId)
    socket.leave(roomName(payload.serverId))
    io.to(roomName(payload.serverId)).emit('server:member-left', { serverId: payload.serverId, userId: payload.userId })
  })

  socket.on('server:message', (payload: {
    serverId: string
    message: { id: string; senderId: string; senderName: string; content: string; timestamp: number; channelId?: string | null; replyTo?: { messageId: string; senderName: string; content: string } | null }
  }, ack?: (result: { success: boolean; duplicate?: boolean; error?: string }) => void) => {
    const respond = (result: { success: boolean; duplicate?: boolean; error?: string }): void => {
      if (typeof ack === 'function') ack(result)
    }
    const entry = servers.get(payload.serverId)
    if (!entry) {
      respond({ success: false, error: 'Server is offline.' })
      return
    }
    const m = entry.members.get(payload.message.senderId)
    if (!m) {
      respond({ success: false, error: 'You are not a member of this server.' })
      return
    }
    if (m.isMuted) {
      socket.emit('server:error', { serverId: payload.serverId, reason: 'You are muted.' })
      respond({ success: false, error: 'You are muted.' })
      return
    }
    if (entry.acceptedMessageIds.has(payload.message.id)) {
      respond({ success: true, duplicate: true })
      return
    }
    entry.acceptedMessageIds.set(payload.message.id, Date.now())
    if (entry.acceptedMessageIds.size > 5000) {
      const oldest = entry.acceptedMessageIds.keys().next().value as string | undefined
      if (oldest) entry.acceptedMessageIds.delete(oldest)
    }
    io.to(roomName(payload.serverId)).emit('server:message', payload)
    respond({ success: true })
  })

  // Moderation — permission-based: host always; the legacy moderator tier
  // carries the moderator bundle; custom roles grant specific bits.
  function actorPermitted(entry: ServerEntry, actorId: string, perm: number): boolean {
    if (actorId === entry.hostUserId) return true
    const actor = entry.members.get(actorId)
    if (!actor) return false
    if (actor.role === 'host') return true
    let mask = 0
    if (actor.role === 'moderator') mask |= MODERATOR_BUNDLE
    const roles = Array.isArray(entry.roles)
      ? (entry.roles as Array<{ id?: string; permissions?: number }>)
      : []
    const ids = actor.roleIds ?? []
    for (const r of roles) {
      if (r?.id && ids.includes(r.id)) mask |= r.permissions ?? 0
    }
    return (mask & perm) === perm
  }

  socket.on('server:mute', (payload: { serverId: string; actorId: string; targetId: string; mute: boolean }) => {
    const entry = servers.get(payload.serverId)
    if (!entry || !actorPermitted(entry, payload.actorId, PERM.muteMembers)) return
    const target = entry.members.get(payload.targetId)
    if (!target || target.role === 'host') return
    target.isMuted = payload.mute
    io.to(roomName(payload.serverId)).emit('server:member-muted', { serverId: payload.serverId, userId: payload.targetId, mute: payload.mute })
  })

  socket.on('server:kick', (payload: { serverId: string; actorId: string; targetId: string }) => {
    const entry = servers.get(payload.serverId)
    if (!entry || !actorPermitted(entry, payload.actorId, PERM.kickMembers)) return
    const target = entry.members.get(payload.targetId)
    if (!target || target.role === 'host') return
    entry.members.delete(payload.targetId)
    io.to(roomName(payload.serverId)).emit('server:member-kicked', { serverId: payload.serverId, userId: payload.targetId })
    // Also tell the target directly (in case they're offline from the room).
    emitToUser(payload.targetId, 'server:you-were-kicked', { serverId: payload.serverId })
  })

  socket.on('server:ban', (payload: { serverId: string; actorId: string; targetId: string }) => {
    const entry = servers.get(payload.serverId)
    if (!entry || !actorPermitted(entry, payload.actorId, PERM.banMembers)) return
    const target = entry.members.get(payload.targetId)
    if (target && target.role === 'host') return
    entry.banned.add(payload.targetId)
    entry.members.delete(payload.targetId)
    io.to(roomName(payload.serverId)).emit('server:member-banned', { serverId: payload.serverId, userId: payload.targetId })
    emitToUser(payload.targetId, 'server:you-were-banned', { serverId: payload.serverId })
  })

  socket.on('server:set-role', (payload: { serverId: string; actorId: string; targetId: string; role: 'moderator' | 'member' }) => {
    const entry = servers.get(payload.serverId)
    // Tier changes remain host-only — tiers are the trust anchor.
    if (!entry || payload.actorId !== entry.hostUserId) return
    const target = entry.members.get(payload.targetId)
    if (!target || target.role === 'host') return
    target.role = payload.role
    io.to(roomName(payload.serverId)).emit('server:member-role-changed', { serverId: payload.serverId, userId: payload.targetId, role: payload.role })
  })

  socket.on('join-room', (roomId: string) => {
    // Voice user-limit gate (channel settings). Checked BEFORE joining so a
    // full room never even sees the newcomer. The host always gets in, and a
    // socket re-claiming its own seat is allowed through.
    const voiceCheck = parseVoiceRoom(roomId)
    if (voiceCheck && socket.data.userId) {
      const entry = servers.get(voiceCheck.serverId)
      if (entry && socket.data.userId !== entry.hostUserId) {
        const chans = (entry.layout as { channels?: Array<{ id?: string; userLimit?: number }> } | null)?.channels
        const ch = Array.isArray(chans) ? chans.find((c) => c?.id === voiceCheck.channelId) : undefined
        const limit = typeof ch?.userLimit === 'number' ? ch.userLimit : 0
        if (limit > 0) {
          const seats = voiceRoomMembers.get(roomId)
          const alreadyIn = seats?.has(socket.data.userId) ?? false
          if (!alreadyIn && (seats?.size ?? 0) >= limit) {
            socket.emit('server:voice-join-denied', {
              serverId: voiceCheck.serverId,
              channelId: voiceCheck.channelId,
              reason: `Voice channel is full (${limit} max).`
            })
            return
          }
        }
      }
    }

    const voice = parseVoiceRoom(roomId)
    const existingVoiceMembers = voice ? voiceRoomMembers.get(roomId) : null
    socket.join(roomId)
    socket.data.roomId = roomId
    if (existingVoiceMembers && socket.data.userId) {
      for (const [userId, socketId] of existingVoiceMembers) {
        if (userId !== socket.data.userId) socket.emit('user-joined', userId, socketId, roomId)
      }
    }
    // Notify others in the room
    socket.to(roomId).emit('user-joined', socket.data.userId, socket.id, roomId)
    console.log(`[socket] ${socket.data.userId} joined room: ${roomId}`)

    // Broadcast voice channel participation.
    // registerVoiceMember evicts any stale entry for this userId first
    // (and emits server:voice-left for the old seat) so clients never end
    // up with a ghost duplicate after a host disconnect + fast reconnect.
    if (voice && socket.data.userId) {
      registerVoiceMember(roomId, socket.data.userId, socket.id)
      const id = identityFor(voice.serverId, socket.data.userId)
      replayActiveStreamsToSocket(roomId, socket.id, socket.data.userId)
      io.to(roomName(voice.serverId)).emit('server:voice-joined', {
        userId: socket.data.userId,
        channelId: voice.channelId,
        serverId: voice.serverId,
        username: id.username,
        avatarColor: id.avatarColor
      })
    }
  })

  socket.on('leave-room', (targetRoomId?: unknown) => {
    const roomId = typeof targetRoomId === 'string' ? targetRoomId : socket.data.roomId
    if (roomId && socket.rooms.has(roomId)) {
      socket.to(roomId).emit('user-left', socket.data.userId, socket.id, roomId)
      socket.leave(roomId)
      console.log(`[socket] ${socket.data.userId} left room: ${roomId}`)

      const voice = parseVoiceRoom(roomId)
      if (voice && socket.data.userId) {
        const removed = unregisterVoiceMember(roomId, socket.data.userId, socket.id)
        if (removed) {
          clearActiveStream(roomId, socket.data.userId)
          io.to(roomName(voice.serverId)).emit('server:voice-left', {
            userId: socket.data.userId,
            serverId: voice.serverId
          })
        }
      }
      if (socket.data.roomId === roomId) socket.data.roomId = null
    }
  })

  // Voice stream state (screen/camera). Media frames are relayed below, but
  // the UI needs an explicit stop signal because a canvas capture stream can
  // remain "live" after the sender stops producing frames.
  socket.on('stream:start', (serverId: string, payload: { userId?: string; kind?: 'screen' | 'window' | 'camera'; paused?: boolean }) => {
    const voice = activeVoiceRoomForSocket(socket.id, serverId)
    if (!voice || !socket.rooms.has(voice.roomId)) return
    let streams = activeVoiceStreams.get(voice.roomId)
    if (!streams) {
      streams = new Map()
      activeVoiceStreams.set(voice.roomId, streams)
    }
    streams.set(socket.data.userId, { kind: payload?.kind, paused: !!payload?.paused })
    io.to(roomName(serverId)).emit('server:stream-start', {
      serverId,
      channelId: voice.channelId,
      userId: socket.data.userId,
      kind: payload?.kind,
      paused: !!payload?.paused
    })
  })

  socket.on('stream:pause', (serverId: string, payload: { paused?: boolean }) => {
    const voice = activeVoiceRoomForSocket(socket.id, serverId)
    if (!voice || !socket.rooms.has(voice.roomId)) return
    const streams = activeVoiceStreams.get(voice.roomId)
    const info = streams?.get(socket.data.userId)
    if (!info) return
    info.paused = !!payload?.paused
    io.to(roomName(serverId)).emit('server:stream-pause', {
      serverId,
      channelId: voice.channelId,
      userId: socket.data.userId,
      paused: info.paused
    })
  })

  socket.on('stream:stop', (serverId: string) => {
    const voice = activeVoiceRoomForSocket(socket.id, serverId)
    if (!voice || !socket.rooms.has(voice.roomId)) return
    clearActiveStream(voice.roomId, socket.data.userId)
  })

  // ── Media relay (host-routed voice/video — no WebRTC, no peer-to-peer) ──
  // Audio uses volatile emits: under congestion it drops packets instead of
  // queueing them, which is exactly what realtime voice wants.
  socket.on('media:audio', (roomId: string, meta: unknown, payload: unknown) => {
    if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) return
    socket.to(roomId).volatile.emit('media:audio', socket.data.userId, meta, payload)
  })

  socket.on('media:video', (roomId: string, meta: unknown, payload: unknown) => {
    if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) return
    const isKeyframe = Boolean((meta as { key?: unknown } | null)?.key)
    const target = socket.to(roomId)
    if (isKeyframe) target.emit('media:video', socket.data.userId, meta, payload)
    else target.volatile.emit('media:video', socket.data.userId, meta, payload)
  })

  socket.on('media:keyframe-request', (roomId: string, targetUserId?: unknown) => {
    if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) return
    const target = typeof targetUserId === 'string' ? targetUserId : null
    if (target) {
      const targetSocketId = voiceRoomMembers.get(roomId)?.get(target)
      if (targetSocketId) {
        io.to(targetSocketId).emit('media:keyframe-request', roomId, socket.data.userId)
        return
      }
    }
    socket.to(roomId).emit('media:keyframe-request', roomId, socket.data.userId)
  })

  // RTT probe for the voice bar's ping display.
  socket.on('media:ping', (sentAt: unknown) => {
    socket.emit('media:pong', sentAt)
  })

  socket.on('offer', (targetSocketId: string, offer: unknown) => {
    io.to(targetSocketId).emit('offer', socket.id, offer, socket.data.userId)
  })

  socket.on('answer', (targetSocketId: string, answer: unknown) => {
    io.to(targetSocketId).emit('answer', socket.id, answer)
  })

  socket.on('ice-candidate', (targetSocketId: string, candidate: unknown) => {
    io.to(targetSocketId).emit('ice-candidate', socket.id, candidate)
  })

  // DM message relay — used when no P2P data channel exists yet.
  // deliverOrQueue, NOT direct emit: edits/deletes/reactions were already
  // queued for offline users, but the actual MESSAGE was silently dropped —
  // sender saw "sent", recipient never received anything.
  socket.on('dm-message', (targetUserId: string, message: string) => {
    deliverOrQueue(targetUserId, 'dm-message', socket.data.userId, message)
  })

  // DM edit/delete relay
  socket.on('dm-edit', (targetUserId: string, payload: { messageId: string; content: string; editedAt: number }) => {
    deliverOrQueue(targetUserId, 'dm-edit', socket.data.userId, payload)
  })

  socket.on('dm-delete', (targetUserId: string, payload: { messageId: string }) => {
    deliverOrQueue(targetUserId, 'dm-delete', socket.data.userId, payload)
  })

  socket.on('dm-pin', (targetUserId: string, payload: { messageId: string; pinned: boolean }) => {
    deliverOrQueue(targetUserId, 'dm-pin', socket.data.userId, payload)
  })

  // DM reactions — forward add/remove to the other party.
  socket.on('dm-reaction', (targetUserId: string, payload: { messageId: string; emojiId: string; userId: string; add: boolean }) => {
    deliverOrQueue(targetUserId, 'dm-reaction', socket.data.userId, payload)
  })

  // Server message reaction — broadcast to all room members.
  socket.on('server:message-reaction', (payload: { serverId: string; messageId: string; emojiId: string; userId: string; add: boolean }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    io.to(roomName(payload.serverId)).emit('server:message-reaction', payload)
  })

  // Server message edit/delete
  socket.on('server:message-edit', (payload: { serverId: string; messageId: string; senderId: string; content: string; editedAt: number }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    io.to(roomName(payload.serverId)).emit('server:message-edit', payload)
  })

  socket.on('server:message-delete', (payload: { serverId: string; messageId: string; actorId: string }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    // Allow if actor is sender OR host/moderator
    const actor = entry.members.get(payload.actorId)
    if (!actor) return
    if (actor.role !== 'host' && actor.role !== 'moderator') {
      // Non-moderators can only delete their own — but we don't track message sender on server.
      // Just relay and let the client handle authorization (the client already checks senderId).
    }
    io.to(roomName(payload.serverId)).emit('server:message-delete', payload)
  })

  socket.on('server:message-pin', (payload: { serverId: string; messageId: string; actorId: string; pinned: boolean }) => {
    const entry = servers.get(payload.serverId)
    if (!entry || !actorPermitted(entry, payload.actorId, PERM.manageMessages)) return
    io.to(roomName(payload.serverId)).emit('server:message-pin', payload)
  })

  // Call signaling
  socket.on('call-invite', (targetUserId: string, callData: unknown) => {
    if (!emitToUser(targetUserId, 'call-invite', socket.data.userId, callData)) {
      // Target isn't connected to THIS host. Calls are real-time and same-host
      // only (there's no offline queue for them), so tell the caller right away
      // instead of leaving them ringing into the void.
      socket.emit('call-unreachable', targetUserId)
    }
  })

  socket.on('call-accept', (targetUserId: string) => {
    emitToUser(targetUserId, 'call-accept', socket.data.userId)
  })

  socket.on('call-reject', (targetUserId: string) => {
    emitToUser(targetUserId, 'call-reject', socket.data.userId)
  })

  socket.on('call-end', (targetUserId: string) => {
    emitToUser(targetUserId, 'call-end', socket.data.userId)
  })

  socket.on('call-video-state', (targetUserId: string, payload: { enabled?: boolean }) => {
    emitToUser(targetUserId, 'call-video-state', socket.data.userId, {
      enabled: Boolean(payload?.enabled)
    })
  })

  socket.on('disconnect', () => {
    // Notify room if in one
    if (socket.data.roomId) {
      const roomId = socket.data.roomId
      socket.to(roomId).emit('user-left', socket.data.userId, socket.id, roomId)
    }
    // Scrub this socket from EVERY voice room it was in — not just
    // `socket.data.roomId`, which only tracks the most-recently-joined
    // room and leaks entries when the same socket hopped between rooms.
    const voiceRooms = socketVoiceRooms.get(socket.id)
    if (voiceRooms && socket.data.userId) {
      for (const roomId of voiceRooms) {
        const voice = parseVoiceRoom(roomId)
        if (!voice) continue
        const removed = unregisterVoiceMember(roomId, socket.data.userId, socket.id)
        if (removed) {
          clearActiveStream(roomId, socket.data.userId)
          io.to(roomName(voice.serverId)).emit('server:voice-left', {
            userId: socket.data.userId,
            serverId: voice.serverId
          })
        }
      }
    }
    socketVoiceRooms.delete(socket.id)
    // Remove user from any server member lists they're in and notify rooms.
    // If a newer socket for the same user already registered, this disconnect
    // belongs to a stale socket and must not announce the user as offline.
    const disconnectedUserId = socket.data.userId as string | undefined
    const hasRemainingUserSockets = disconnectedUserId ? removeUserSocket(disconnectedUserId, socket.id) : false
    if (disconnectedUserId && !hasRemainingUserSockets) {
      for (const entry of servers.values()) {
        if (entry.hostSocketId === socket.id) {
          servers.delete(entry.id)
          io.to(roomName(entry.id)).emit('server:error', { serverId: entry.id, reason: 'Host disconnected, server closed.' })
        } else if (entry.members.has(disconnectedUserId)) {
          entry.members.delete(disconnectedUserId)
          socket.to(roomName(entry.id)).emit('server:member-left', { serverId: entry.id, userId: disconnectedUserId })
        }
      }
      // Mark user offline and notify their observers.
      const existing = statusMap.get(disconnectedUserId)
      statusMap.set(disconnectedUserId, {
        status: 'offline',
        invisible: existing?.invisible ?? false,
        lastSeen: Date.now()
      })
      notifyObservers(disconnectedUserId)
      // Remove self from observer lists of anyone this socket subscribed to.
      const subs = socketFriendSubs.get(socket.id)
      if (subs) {
        for (const fid of subs) observedBy.get(fid)?.delete(disconnectedUserId)
        socketFriendSubs.delete(socket.id)
      }
      if (presence.has(disconnectedUserId)) {
        presence.delete(disconnectedUserId)
        io.emit('presence:changed', { userId: disconnectedUserId, removed: true })
      }
    } else if (disconnectedUserId) {
      const replacementSocketId = firstLiveUserSocketId(disconnectedUserId)
      if (replacementSocketId) {
        for (const entry of servers.values()) {
          if (entry.hostSocketId === socket.id) entry.hostSocketId = replacementSocketId
        }
      }
      socketFriendSubs.delete(socket.id)
    }
    console.log(`[socket] disconnected: ${socket.id} (${socket.data.userId || 'unknown'})`)
  })
})

// ── Start / Stop (this instance) ──

let running = false

function startVoiceUdpRelay(): void {
  if (voiceUdpSocket) return
  const sock = dgram.createSocket('udp4')
  voiceUdpSocket = sock

  sock.on('message', handleVoiceUdpMessage)
  sock.on('error', (err) => {
    console.warn(`[voice-udp:${instancePort}] disabled:`, err.message)
    if (voiceUdpSocket === sock) voiceUdpSocket = null
    voiceUdpEndpoints.clear()
    try { sock.close() } catch { /* ignore */ }
  })
  sock.bind(instancePort, () => {
    console.log(`[voice-udp:${instancePort}] listening`)
  })

  if (!voiceUdpCleanupTimer) {
    voiceUdpCleanupTimer = setInterval(pruneVoiceUdpEndpoints, 10000)
    voiceUdpCleanupTimer.unref?.()
  }
}

function stopVoiceUdpRelay(): Promise<void> {
  return new Promise((resolve) => {
    if (voiceUdpCleanupTimer) {
      clearInterval(voiceUdpCleanupTimer)
      voiceUdpCleanupTimer = null
    }
    voiceUdpEndpoints.clear()

    const sock = voiceUdpSocket
    voiceUdpSocket = null
    if (!sock) {
      resolve()
      return
    }
    sock.removeAllListeners('message')
    sock.once('close', () => resolve())
    try {
      sock.close()
    } catch {
      resolve()
    }
  })
}

function start(): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    if (running) {
      resolve({ port: instancePort })
      return
    }
    const onError = (err: NodeJS.ErrnoException): void => {
      httpServer.removeListener('error', onError)
      reject(err)
    }
    httpServer.once('error', onError)
    httpServer.listen(instancePort, () => {
      httpServer.removeListener('error', onError)
      running = true
      console.log(`[signaling:${instancePort}] listening`)
      startVoiceUdpRelay()
      resolve({ port: instancePort })
    })
  })
}

function stop(): Promise<void> {
  return new Promise((resolve) => {
    if (!running) {
      stopVoiceUdpRelay().then(resolve)
      return
    }
    // io.close() also closes the underlying http server.
    io.close(() => {
      running = false
      console.log(`[signaling:${instancePort}] stopped`)
      stopVoiceUdpRelay().then(resolve)
    })
  })
}

return { start, stop, isRunning: () => running, port: instancePort }
} // ── end createSignalingInstance ──

// CLI entrypoint — only runs when invoked directly (e.g. `tsx src/server/signaling.ts`).
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000', 10)
  createSignalingInstance(PORT).start().then(() => {
    console.log(`\n  MESH signaling server running on port ${PORT}\n`)
  })
}
