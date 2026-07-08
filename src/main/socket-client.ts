import { io, Socket } from 'socket.io-client'
import { BrowserWindow } from 'electron'
import { getServer, getSetting } from './database'

let socket: Socket | null = null
let mainWindow: BrowserWindow | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let reconnectAttempts: number = 0
let currentUrl: string = ''
let currentUserId: string = ''
let isConnecting = false
const auxiliarySockets = new Map<string, Socket>()

// Outbound events emitted while the socket was down. socket.io's own send
// buffer dies with the socket object, and our reconnect creates a NEW socket
// each attempt — so without this queue, every emit during a reconnect window
// (DM sends, reactions, edits...) vanished while the UI showed "sent".
// Flushed right after register-user on the next successful connect.
const MAX_PENDING_EMITS = 200
let pendingEmits: Array<{ event: string; args: unknown[] }> = []

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
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
  'server:stream-stop',
  'server:error'
]

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
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
    return hostedRouteForServer(typeof payload?.serverId === 'string' ? payload.serverId : null, forcedPort)
  }
  if (event === 'join-room' || event === 'leave-room') {
    const roomId = typeof args[0] === 'string' ? args[0] : ''
    const parts = roomId.split(':')
    return parts[0] === 'voice' ? hostedRouteForServer(parts[1] ?? null) : null
  }
  if (event.startsWith('media:')) {
    const roomId = typeof args[0] === 'string' ? args[0] : ''
    const parts = roomId.split(':')
    return parts[0] === 'voice' ? hostedRouteForServer(parts[1] ?? null) : null
  }
  if (event === 'stream:start' || event === 'stream:stop') {
    return hostedRouteForServer(typeof args[0] === 'string' ? args[0] : null)
  }
  return null
}

function attachAuxiliaryHandlers(aux: Socket, userId: string): void {
  aux.on('connect', () => {
    aux.emit('register-user', userId)
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
  for (const evt of serverEvents) {
    aux.on(evt, (payload: unknown) => {
      sendToRenderer(`signaling:${evt}`, payload)
    })
  }
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
  attachAuxiliaryHandlers(aux, userId)
  return aux
}

function emitOnSocket(target: Socket, event: string, args: unknown[]): void {
  if (target.connected) {
    target.emit(event, ...args)
    return
  }
  target.once('connect', () => target.emit(event, ...args))
}

export function connectToSignaling(serverUrl: string, userId: string): Promise<void> {
  // Prevent duplicate connections
  if (isConnecting) {
    console.log('[socket-client] connection already in progress, ignoring')
    return Promise.resolve()
  }
  if (socket?.connected && currentUrl === serverUrl && currentUserId === userId) {
    console.log('[socket-client] already connected to same server, ignoring')
    return Promise.resolve()
  }

  isConnecting = true
  currentUrl = serverUrl
  currentUserId = userId

  if (socket?.connected) {
    socket.disconnect()
  }

  socket = io(serverUrl, {
    transports: ['websocket'],
    reconnection: false
  })

  socket.on('connect', () => {
    isConnecting = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectAttempts = 0
    sendToRenderer('signaling:reconnect-status', { state: 'connected' })
    socket!.emit('register-user', userId)
    // Flush everything queued while we were offline, preserving order.
    if (pendingEmits.length > 0) {
      const toFlush = pendingEmits
      pendingEmits = []
      console.log(`[socket-client] flushing ${toFlush.length} queued emit(s)`)
      for (const { event, args } of toFlush) {
        socket!.emit(event, ...args)
      }
    }
    sendToRenderer('signaling:connected')
  })

  socket.on('disconnect', (reason) => {
    sendToRenderer('signaling:disconnected', reason)
    tryReconnect()
  })

  socket.on('connect_error', (err) => {
    isConnecting = false
    sendToRenderer('signaling:error', err.message)
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
    sendToRenderer('signaling:presence:changed', payload)
  })

  socket.on('presence:snapshot', (payload: unknown) => {
    sendToRenderer('signaling:presence:snapshot', payload)
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
      // Log join-ack for debugging
      if (evt === 'server:join-ack') {
        console.log('[socket-client] server:join-ack received:', JSON.stringify(payload, null, 2).slice(0, 500))
      }
      sendToRenderer(`signaling:${evt}`, payload)
    })
  }

  return new Promise((resolve) => {
    socket!.once('connect', () => resolve())
    // Fall back after a short timeout so the IPC call doesn't hang
    setTimeout(resolve, 3000)
  })
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
  reconnectTimer = setTimeout(() => {
    if (socket?.connected) return
    connectToSignaling(currentUrl, currentUserId).catch(() => {})
  }, delay)
}

export function disconnectFromSignaling(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  socket?.disconnect()
  socket = null
}

export function emitSignaling(event: string, ...args: unknown[]): void {
  const route = routeForEvent(event, args)
  if (route) {
    const routeUrl = normalizeUrl(route.url)
    if (socket?.connected && normalizeUrl(currentUrl) === routeUrl && currentUserId === route.userId) {
      socket.emit(event, ...args)
      return
    }
    emitOnSocket(auxiliarySocketFor(routeUrl, route.userId), event, args)
    return
  }

  if (socket?.connected) {
    socket.emit(event, ...args)
    return
  }
  // Socket down — queue for the flush that follows the next connect.
  if (pendingEmits.length < MAX_PENDING_EMITS) {
    pendingEmits.push({ event, args })
  }
}

export function emitSignalingWithAck(
  event: string,
  arg: unknown,
  cb: (response: unknown) => void
): void {
  if (!socket) { cb(null); return }
  if (arg === undefined) socket.emit(event, cb)
  else socket.emit(event, arg, cb)
}

export function isConnected(): boolean {
  return socket?.connected ?? false
}

export function getSocketId(): string | null {
  return socket?.id ?? null
}
