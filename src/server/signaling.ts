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
import fs from 'fs'
import path from 'path'

const app = express()
const httpServer = createServer(app)
const io = new SocketServer(httpServer, { cors: { origin: '*' } })

// ── Relay Registry ──

interface RelayEntry {
  id: string
  address: string
  scope: 'isp-local' | 'global'
  lastHeartbeat: number
  users: number
}

const relays = new Map<string, RelayEntry>()

app.use(express.json())

app.post('/register-relay', (req, res) => {
  const { id, address, scope } = req.body
  relays.set(id, { id, address, scope, lastHeartbeat: Date.now(), users: 0 })
  console.log(`[relay] registered: ${id} @ ${address} (${scope})`)
  res.json({ ok: true })
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

// Track which userId maps to which socketId for DM routing
const userSockets = new Map<string, string>()

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
    const sid = userSockets.get(observerId)
    if (sid) io.to(sid).emit('status:changed', payload)
  }
}

// ── Community Servers ──
interface ServerMemberInfo {
  userId: string
  username: string
  avatarColor: string | null
  role: 'host' | 'moderator' | 'member'
  isMuted: boolean
}
interface ServerEntry {
  id: string
  name: string
  iconColor: string
  textChannelName: string
  voiceRoomName: string
  hostUserId: string
  hostUsername: string
  hostAvatarColor: string | null
  hostSocketId: string | null
  members: Map<string, ServerMemberInfo>
  banned: Set<string>
  passwordHash?: string | null
}
const servers = new Map<string, ServerEntry>()

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

const QUEUE_FILE = path.join(process.cwd(), 'offline_queue.json')
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

function saveQueueAsync() {
  const obj = Object.fromEntries(offlineQueue)
  fs.writeFile(QUEUE_FILE, JSON.stringify(obj), () => {})
}

function deliverOrQueue(targetUserId: string, event: string, ...args: unknown[]): void {
  const sid = userSockets.get(targetUserId)
  if (sid) {
    io.to(sid).emit(event, ...args)
  } else {
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

  socket.on('register-user', (userId: string) => {
    socket.data.userId = userId
    userSockets.set(userId, socket.id)
    console.log(`[socket] user registered: ${userId} -> ${socket.id}`)
    flushQueue(userId, socket.id)
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
    io.emit('presence:changed', entry)
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
    deliverOrQueue(payload.toUserId, 'friend-request:incoming', payload)
  })

  // Payload: { requestId, fromUserId (accepter), fromUsername, fromAvatarColor, toUserId (original sender) }
  socket.on('friend-request:accept', (payload: { requestId: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string }) => {
    deliverOrQueue(payload.toUserId, 'friend-request:accepted', payload)
  })

  // Payload: { requestId, fromUserId (rejecter), toUserId (original sender) }
  socket.on('friend-request:reject', (payload: { requestId: string; fromUserId: string; toUserId: string }) => {
    deliverOrQueue(payload.toUserId, 'friend-request:rejected', payload)
  })

  // Payload: { requestId, fromUserId (canceller = original sender), toUserId (recipient) }
  socket.on('friend-request:cancel', (payload: { requestId: string; fromUserId: string; toUserId: string }) => {
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
    deliverOrQueue(payload.toUserId, 'message-request:message-incoming', payload)
  })

  // ── Community Servers ──

  // Host registers (or re-registers) their server on the signaling network.
  socket.on('server:register', (payload: {
    serverId: string
    name: string
    iconColor: string
    textChannelName: string
    voiceRoomName: string
    hostUserId: string
    hostUsername: string
    hostAvatarColor: string | null
    members: ServerMemberInfo[]
    banned: string[]
    passwordHash?: string | null
  }) => {
    let entry = servers.get(payload.serverId)
    if (!entry) {
      entry = {
        id: payload.serverId,
        name: payload.name,
        iconColor: payload.iconColor,
        textChannelName: payload.textChannelName,
        voiceRoomName: payload.voiceRoomName,
        hostUserId: payload.hostUserId,
        hostUsername: payload.hostUsername,
        hostAvatarColor: payload.hostAvatarColor,
        hostSocketId: socket.id,
        members: new Map(),
        banned: new Set(payload.banned),
        passwordHash: payload.passwordHash
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
    }
    // Reset member list with host authoritative snapshot
    entry.members.clear()
    for (const m of payload.members) entry.members.set(m.userId, m)
    socket.join(roomName(payload.serverId))
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
    if (!entry) {
      socket.emit('server:join-denied', { serverId: payload.serverId, reason: 'Server not found or host offline.' })
      return
    }
    if (entry.banned.has(payload.userId)) {
      socket.emit('server:join-denied', { serverId: payload.serverId, reason: 'You are banned from this server.' })
      return
    }
    if (entry.passwordHash && entry.passwordHash !== payload.passwordHash) {
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

    // Send joiner the current state.
    socket.emit('server:join-ack', {
      serverId: entry.id,
      name: entry.name,
      iconColor: entry.iconColor,
      textChannelName: entry.textChannelName,
      voiceRoomName: entry.voiceRoomName,
      hostUserId: entry.hostUserId,
      hostUsername: entry.hostUsername,
      hostAvatarColor: entry.hostAvatarColor,
      members: serialiseMembers(entry),
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
    message: { id: string; senderId: string; senderName: string; content: string; timestamp: number; channelId?: string | null }
  }) => {
    const entry = servers.get(payload.serverId)
    if (!entry) return
    const m = entry.members.get(payload.message.senderId)
    if (!m) return
    if (m.isMuted) {
      socket.emit('server:error', { serverId: payload.serverId, reason: 'You are muted.' })
      return
    }
    io.to(roomName(payload.serverId)).emit('server:message', payload)
  })

  // Moderation — authoriser must be host or moderator.
  function canModerate(entry: ServerEntry, actorId: string, requireHost = false): boolean {
    const actor = entry.members.get(actorId)
    if (!actor) return false
    if (requireHost) return actor.role === 'host'
    return actor.role === 'host' || actor.role === 'moderator'
  }

  socket.on('server:mute', (payload: { serverId: string; actorId: string; targetId: string; mute: boolean }) => {
    const entry = servers.get(payload.serverId)
    if (!entry || !canModerate(entry, payload.actorId)) return
    const target = entry.members.get(payload.targetId)
    if (!target || target.role === 'host') return
    target.isMuted = payload.mute
    io.to(roomName(payload.serverId)).emit('server:member-muted', { serverId: payload.serverId, userId: payload.targetId, mute: payload.mute })
  })

  socket.on('server:kick', (payload: { serverId: string; actorId: string; targetId: string }) => {
    const entry = servers.get(payload.serverId)
    if (!entry || !canModerate(entry, payload.actorId)) return
    const target = entry.members.get(payload.targetId)
    if (!target || target.role === 'host') return
    entry.members.delete(payload.targetId)
    io.to(roomName(payload.serverId)).emit('server:member-kicked', { serverId: payload.serverId, userId: payload.targetId })
    // Also tell the target directly (in case they're offline from the room).
    const sid = userSockets.get(payload.targetId)
    if (sid) io.to(sid).emit('server:you-were-kicked', { serverId: payload.serverId })
  })

  socket.on('server:ban', (payload: { serverId: string; actorId: string; targetId: string }) => {
    const entry = servers.get(payload.serverId)
    if (!entry || !canModerate(entry, payload.actorId, true)) return
    const target = entry.members.get(payload.targetId)
    if (target && target.role === 'host') return
    entry.banned.add(payload.targetId)
    entry.members.delete(payload.targetId)
    io.to(roomName(payload.serverId)).emit('server:member-banned', { serverId: payload.serverId, userId: payload.targetId })
    const sid = userSockets.get(payload.targetId)
    if (sid) io.to(sid).emit('server:you-were-banned', { serverId: payload.serverId })
  })

  socket.on('server:set-role', (payload: { serverId: string; actorId: string; targetId: string; role: 'moderator' | 'member' }) => {
    const entry = servers.get(payload.serverId)
    if (!entry || !canModerate(entry, payload.actorId, true)) return
    const target = entry.members.get(payload.targetId)
    if (!target || target.role === 'host') return
    target.role = payload.role
    io.to(roomName(payload.serverId)).emit('server:member-role-changed', { serverId: payload.serverId, userId: payload.targetId, role: payload.role })
  })

  socket.on('join-room', (roomId: string) => {
    socket.join(roomId)
    socket.data.roomId = roomId
    // Notify others in the room
    socket.to(roomId).emit('user-joined', socket.data.userId, socket.id)
    console.log(`[socket] ${socket.data.userId} joined room: ${roomId}`)
    
    // Broadcast voice channel participation
    if (roomId.startsWith('voice:')) {
      const parts = roomId.split(':')
      if (parts.length >= 2) {
        const serverId = parts[1]
        const channelId = parts.length > 2 ? parts[2] : 'legacy'
        io.to(roomName(serverId)).emit('server:voice-joined', { userId: socket.data.userId, channelId, serverId })
      }
    }
  })

  socket.on('leave-room', () => {
    if (socket.data.roomId) {
      const roomId = socket.data.roomId
      socket.to(roomId).emit('user-left', socket.data.userId, socket.id)
      socket.leave(roomId)
      console.log(`[socket] ${socket.data.userId} left room: ${roomId}`)
      
      if (roomId.startsWith('voice:')) {
        const parts = roomId.split(':')
        if (parts.length >= 2) {
          const serverId = parts[1]
          io.to(roomName(serverId)).emit('server:voice-left', { userId: socket.data.userId, serverId })
        }
      }
      socket.data.roomId = null
    }
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

  // DM message relay — used when no P2P data channel exists yet
  socket.on('dm-message', (targetUserId: string, message: string) => {
    const targetSocketId = userSockets.get(targetUserId)
    if (targetSocketId) {
      io.to(targetSocketId).emit('dm-message', socket.data.userId, message)
    }
  })

  // DM edit/delete relay
  socket.on('dm-edit', (targetUserId: string, payload: { messageId: string; content: string; editedAt: number }) => {
    deliverOrQueue(targetUserId, 'dm-edit', socket.data.userId, payload)
  })

  socket.on('dm-delete', (targetUserId: string, payload: { messageId: string }) => {
    deliverOrQueue(targetUserId, 'dm-delete', socket.data.userId, payload)
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

  // Call signaling
  socket.on('call-invite', (targetUserId: string, callData: unknown) => {
    const targetSocketId = userSockets.get(targetUserId)
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-invite', socket.data.userId, callData)
    }
  })

  socket.on('call-accept', (targetUserId: string) => {
    const targetSocketId = userSockets.get(targetUserId)
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-accept', socket.data.userId)
    }
  })

  socket.on('call-reject', (targetUserId: string) => {
    const targetSocketId = userSockets.get(targetUserId)
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-reject', socket.data.userId)
    }
  })

  socket.on('call-end', (targetUserId: string) => {
    const targetSocketId = userSockets.get(targetUserId)
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-end', socket.data.userId)
    }
  })

  socket.on('disconnect', () => {
    // Notify room if in one
    if (socket.data.roomId) {
      const roomId = socket.data.roomId
      socket.to(roomId).emit('user-left', socket.data.userId, socket.id)
      if (roomId.startsWith('voice:')) {
        const parts = roomId.split(':')
        if (parts.length >= 2) {
          const serverId = parts[1]
          io.to(roomName(serverId)).emit('server:voice-left', { userId: socket.data.userId, serverId })
        }
      }
    }
    // Remove user from any server member lists they're in and notify rooms.
    if (socket.data.userId) {
      for (const entry of servers.values()) {
        if (entry.hostSocketId === socket.id) {
          servers.delete(entry.id)
          io.to(roomName(entry.id)).emit('server:error', { serverId: entry.id, reason: 'Host disconnected, server closed.' })
        } else if (entry.members.has(socket.data.userId)) {
          entry.members.delete(socket.data.userId)
          socket.to(roomName(entry.id)).emit('server:member-left', { serverId: entry.id, userId: socket.data.userId })
        }
      }
      // Mark user offline and notify their observers.
      const existing = statusMap.get(socket.data.userId)
      statusMap.set(socket.data.userId, {
        status: 'offline',
        invisible: existing?.invisible ?? false,
        lastSeen: Date.now()
      })
      notifyObservers(socket.data.userId)
      // Remove self from observer lists of anyone this socket subscribed to.
      const subs = socketFriendSubs.get(socket.id)
      if (subs) {
        for (const fid of subs) observedBy.get(fid)?.delete(socket.data.userId)
        socketFriendSubs.delete(socket.id)
      }
      userSockets.delete(socket.data.userId)
      if (presence.has(socket.data.userId)) {
        presence.delete(socket.data.userId)
        io.emit('presence:changed', { userId: socket.data.userId, removed: true })
      }
    }
    console.log(`[socket] disconnected: ${socket.id} (${socket.data.userId || 'unknown'})`)
  })
})

// ── Start / Stop (embeddable) ──

let running = false
let currentPort = 0

export function startSignalingServer(port = 3000): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    if (running) {
      resolve({ port: currentPort })
      return
    }
    const onError = (err: NodeJS.ErrnoException): void => {
      httpServer.removeListener('error', onError)
      reject(err)
    }
    httpServer.once('error', onError)
    httpServer.listen(port, () => {
      httpServer.removeListener('error', onError)
      running = true
      currentPort = port
      console.log(`[signaling] listening on port ${port}`)
      resolve({ port })
    })
  })
}

export function stopSignalingServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!running) {
      resolve()
      return
    }
    // io.close() also closes the underlying http server.
    io.close(() => {
      running = false
      currentPort = 0
      console.log('[signaling] stopped')
      resolve()
    })
  })
}

export function isSignalingRunning(): boolean {
  return running
}

export function getSignalingPort(): number {
  return currentPort
}

// CLI entrypoint — only runs when invoked directly (e.g. `tsx src/server/signaling.ts`).
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000', 10)
  startSignalingServer(PORT).then(() => {
    console.log(`\n  MESH signaling server running on port ${PORT}\n`)
  })
}
