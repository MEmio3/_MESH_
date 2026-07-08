import { ipcMain, BrowserWindow, shell, desktopCapturer } from 'electron'
import * as identity from './identity'
import * as db from './database'
import * as socketClient from './socket-client'
import * as relayManager from './relay-manager'
import * as avatar from './avatar'
import * as serverAvatar from './server-avatar'
import * as fileManager from './file-manager'
import { showNotification, type NotifyPayload } from './notifications'
import { PERM, MODERATOR_BUNDLE, effectivePermissions, hasPerm, resolveChannelPerm } from '../shared/permissions'
import type {
  FriendRow,
  FriendRequestRow,
  MessageRequestRow,
  ConversationRow,
  MessageRow,
  ServerRow,
  ServerMemberRow,
  ServerMessageRow,
  RelayRow
} from '../shared/types'

interface DiscoveredServerPayload {
  id: string
  name: string
  iconColor: string
  avatarDataUrl: string | null
  textChannelName: string
  voiceRoomName: string
  hostUserId: string
  hostUsername: string
  hostAvatarColor: string | null
  memberCount: number
  onlineMemberCount: number
  requiresPassword: boolean
}

interface NetworkProbeResult {
  success: boolean
  url: string
  latencyMs: number | null
  servers: DiscoveredServerPayload[]
  error?: string
}

function normalizeSignalingUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

function sanitizeDiscoveredServer(raw: unknown): DiscoveredServerPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.id !== 'string' || typeof s.name !== 'string') return null
  return {
    id: s.id,
    name: s.name,
    iconColor: typeof s.iconColor === 'string' ? s.iconColor : '#107C10',
    avatarDataUrl: typeof s.avatarDataUrl === 'string' ? s.avatarDataUrl : null,
    textChannelName: typeof s.textChannelName === 'string' ? s.textChannelName : 'general',
    voiceRoomName: typeof s.voiceRoomName === 'string' ? s.voiceRoomName : 'Voice Lounge',
    hostUserId: typeof s.hostUserId === 'string' ? s.hostUserId : '',
    hostUsername: typeof s.hostUsername === 'string' ? s.hostUsername : 'Unknown host',
    hostAvatarColor: typeof s.hostAvatarColor === 'string' ? s.hostAvatarColor : null,
    memberCount: typeof s.memberCount === 'number' ? s.memberCount : 0,
    onlineMemberCount: typeof s.onlineMemberCount === 'number' ? s.onlineMemberCount : 0,
    requiresPassword: Boolean(s.requiresPassword)
  }
}

/**
 * Register window control IPC handlers.
 * These require a reference to the main BrowserWindow.
 */
export function registerWindowHandlers(mainWindow: BrowserWindow): void {
  ipcMain.on('window:minimize', () => {
    mainWindow.minimize()
  })

  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.on('window:close', () => {
    mainWindow.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow.isMaximized()
  })

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-change', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-change', false)
  })
}

/**
 * Register identity-related IPC handlers.
 * These do NOT need a window reference — they work with the filesystem.
 */
export function registerIdentityHandlers(): void {
  ipcMain.handle('identity:exists', () => {
    return identity.identityExists()
  })

  ipcMain.handle('identity:generate', async (_event, args: { username: string; avatarColor: string | null }) => {
    return identity.generateIdentity(args.username, args.avatarColor)
  })

  ipcMain.handle('identity:load', () => {
    return identity.loadIdentity()
  })

  ipcMain.handle('crypto:hashPassword', async (_event, password: string) => {
    return await identity.hashPassword(password)
  })
}

/**
 * Register database-related IPC handlers.
 */
export function registerDatabaseHandlers(): void {
  // ── Friends ──
  ipcMain.handle('db:friends:list', () => db.getFriends())
  ipcMain.handle('db:friends:add', (_e, friend: FriendRow) => db.addFriend(friend))
  ipcMain.handle('db:friends:remove', (_e, userId: string) => db.removeFriend(userId))
  ipcMain.handle('db:friends:update-status', (_e, args: { userId: string; status: string }) => db.updateFriendStatus(args.userId, args.status))

  // ── Friend Requests ──
  ipcMain.handle('db:friend-requests:list', () => db.getFriendRequests())
  ipcMain.handle('db:friend-requests:add', (_e, req: FriendRequestRow) => db.addFriendRequest(req))
  ipcMain.handle('db:friend-requests:remove', (_e, id: string) => db.removeFriendRequest(id))

  // ── Message Requests ──
  ipcMain.handle('db:message-requests:list', () => db.getMessageRequests())
  ipcMain.handle('db:message-requests:add', (_e, req: MessageRequestRow) => db.addMessageRequest(req))
  ipcMain.handle('db:message-requests:remove', (_e, id: string) => db.removeMessageRequest(id))

  // ── Conversations ──
  ipcMain.handle('db:conversations:list', () => db.getConversations())
  ipcMain.handle('db:conversations:upsert', (_e, conv: ConversationRow) => db.upsertConversation(conv))
  ipcMain.handle('db:conversations:update-unread', (_e, args: { id: string; unreadCount: number }) => db.updateConversationUnread(args.id, args.unreadCount))
  ipcMain.handle('db:conversations:close', (_e, id: string) => db.closeConversation(id))

  // ── Messages ──
  ipcMain.handle('db:messages:list', (_e, args: { conversationId: string; limit?: number; before?: number }) => db.getMessages(args.conversationId, args.limit, args.before))
  ipcMain.handle('db:messages:send', (_e, msg: MessageRow) => db.insertMessage(msg))
  ipcMain.handle('db:messages:update-status', (_e, args: { id: string; status: string }) => db.updateMessageStatus(args.id, args.status))
  ipcMain.handle('db:messages:edit', (_e, args: { id: string; content: string; editedAt: number }) => db.editMessage(args.id, args.content, args.editedAt))
  ipcMain.handle('db:messages:delete', (_e, id: string) => db.deleteMessage(id))
  ipcMain.handle('db:messages:get', (_e, id: string) => db.getMessage(id))

  // ── Server Messages Edit/Delete ──
  ipcMain.handle('db:server-messages:edit', (_e, args: { id: string; content: string; editedAt: number }) => db.editServerMessage(args.id, args.content, args.editedAt))
  ipcMain.handle('db:server-messages:delete', (_e, id: string) => db.deleteServerMessage(id))

  // ── Reactions ──
  ipcMain.handle('reaction:toggle-dm', (_e, args: { messageId: string; emojiId: string; userId: string; add: boolean }) => {
    const nextJson = db.setMessageReaction(args.messageId, args.emojiId, args.userId, args.add)
    return { success: true, reactions: nextJson }
  })
  ipcMain.handle('reaction:toggle-server', (_e, args: { messageId: string; emojiId: string; userId: string; add: boolean }) => {
    const nextJson = db.setServerMessageReaction(args.messageId, args.emojiId, args.userId, args.add)
    return { success: true, reactions: nextJson }
  })
  ipcMain.handle('reaction:apply-dm', (_e, args: { messageId: string; emojiId: string; userId: string; add: boolean }) => {
    const nextJson = db.setMessageReaction(args.messageId, args.emojiId, args.userId, args.add)
    return { success: true, reactions: nextJson }
  })
  ipcMain.handle('reaction:apply-server', (_e, args: { messageId: string; emojiId: string; userId: string; add: boolean }) => {
    const nextJson = db.setServerMessageReaction(args.messageId, args.emojiId, args.userId, args.add)
    return { success: true, reactions: nextJson }
  })

  // ── Servers ──
  ipcMain.handle('db:servers:list', () => db.getServers())
  ipcMain.handle('db:servers:add', (_e, server: ServerRow) => db.addServer(server))
  ipcMain.handle('db:servers:remove', (_e, serverId: string) => db.removeServer(serverId))

  // ── Server Members ──
  ipcMain.handle('db:server-members:list', (_e, serverId: string) => db.getServerMembers(serverId))
  ipcMain.handle('db:server-members:add', (_e, member: ServerMemberRow) => db.addServerMember(member))

  // ── Server Messages ──
  ipcMain.handle('db:server-messages:list', (_e, args: { serverId: string; limit?: number; before?: number }) => db.getServerMessages(args.serverId, args.limit, args.before))
  ipcMain.handle('db:server-messages:send', (_e, msg: ServerMessageRow) => db.insertServerMessage(msg))

  // ── Blocked Users ──
  ipcMain.handle('db:blocked:list', () => db.getBlockedUsers())
  ipcMain.handle('db:blocked:add', (_e, args: { userId: string; username: string }) => db.blockUser(args.userId, args.username))
  ipcMain.handle('db:blocked:remove', (_e, userId: string) => db.unblockUser(userId))

  // ── Relays ──
  ipcMain.handle('db:relays:list', () => db.getRelays())
  ipcMain.handle('db:relays:add', (_e, relay: RelayRow) =>
    // Normalise credential fields — better-sqlite3 throws on `undefined`
    // bind values, and older callers won't send username/password.
    db.addRelay({ ...relay, username: relay.username ?? null, password: relay.password ?? null }))
  ipcMain.handle('db:relays:remove', (_e, id: string) => db.removeRelay(id))

  // ── Settings ──
  ipcMain.handle('db:settings:get', (_e, key: string) => db.getSetting(key))
  ipcMain.handle('db:settings:set', (_e, args: { key: string; value: string }) => db.setSetting(args.key, args.value))
}

/**
 * Register friend-request orchestration IPC handlers.
 * Validates, persists to DB, and emits on the signaling socket.
 */
export function registerFriendRequestHandlers(): void {
  // Send: { id, fromUserId, fromUsername, fromAvatarColor, toUserId, timestamp }
  ipcMain.handle('friend-request:send', async (_e, payload: {
    id: string
    fromUserId: string
    fromUsername: string
    fromAvatarColor: string | null
    toUserId: string
    timestamp: number
  }) => {
    // Validation
    if (payload.fromUserId === payload.toUserId) {
      return { success: false, error: 'Cannot send a friend request to yourself.' }
    }
    if (db.findFriend(payload.toUserId)) {
      return { success: false, error: 'Already friends with this user.' }
    }
    if (db.findBlocked(payload.toUserId)) {
      return { success: false, error: 'This user is blocked.' }
    }
    const existing = db.findFriendRequestBetween(payload.fromUserId, payload.toUserId)
    if (existing) {
      // Mutual-request collision: the other user already sent one to us. Rather
      // than rejecting (which used to leave BOTH sides stuck with a pending
      // request neither could accept), auto-promote to friend as if the user
      // had clicked Accept on the existing incoming.
      if (existing.direction === 'incoming' && existing.fromUserId === payload.toUserId) {
        db.addFriend({
          userId: existing.fromUserId,
          username: existing.fromUsername,
          avatarColor: existing.fromAvatarColor,
          status: 'offline',
          lastSeen: null
        })
        db.upsertConversation({
          id: `dm_${existing.fromUserId}`,
          recipientId: existing.fromUserId,
          recipientName: existing.fromUsername,
          recipientAvatarColor: existing.fromAvatarColor,
          recipientStatus: 'offline',
          unreadCount: 0
        })
        db.removeFriendRequest(existing.id)
        socketClient.emitSignaling('friend-request:accept', {
          requestId: existing.id,
          fromUserId: payload.fromUserId,
          fromUsername: payload.fromUsername,
          fromAvatarColor: payload.fromAvatarColor,
          toUserId: existing.fromUserId
        })
        return { success: true, autoAccepted: true }
      }
      // Already outgoing — silently succeed (don't spam the user).
      return { success: false, error: 'A friend request already exists with this user.' }
    }

    // Persist locally as outgoing
    db.addFriendRequest({
      id: payload.id,
      fromUserId: payload.fromUserId,
      fromUsername: payload.fromUsername,
      fromAvatarColor: payload.fromAvatarColor,
      toUserId: payload.toUserId,
      toUsername: '',
      toAvatarColor: null,
      timestamp: payload.timestamp,
      direction: 'outgoing'
    })

    // Route via signaling (queued if recipient offline)
    socketClient.emitSignaling('friend-request:send', payload)
    return { success: true }
  })

  // Accept an incoming request. Payload: { requestId, selfUserId, selfUsername, selfAvatarColor }
  ipcMain.handle('friend-request:accept', async (_e, payload: {
    requestId: string
    selfUserId: string
    selfUsername: string
    selfAvatarColor: string | null
  }) => {
    const all = db.getFriendRequests()
    const req = all.find((r) => r.id === payload.requestId)
    if (!req) return { success: false, error: 'Request not found.' }

    // Only an INCOMING request may be accepted. A sender must never be able to
    // accept their own outgoing request — doing so used to unilaterally add the
    // other person as a friend with zero involvement from them, which also
    // "worked" across hosts (no signaling round-trip needed). A real friendship
    // requires the recipient — who is on the same signaling host — to accept,
    // so genuine mutual collisions are already auto-resolved at send time.
    if (req.direction !== 'incoming') {
      return { success: false, error: 'You can only accept requests that were sent to you.' }
    }

    // Promote to friend + create conversation locally.
    const targetUserId = req.fromUserId
    const targetUsername = req.fromUsername
    const targetAvatar = req.fromAvatarColor

    db.addFriend({
      userId: targetUserId,
      username: targetUsername,
      avatarColor: targetAvatar,
      status: 'offline',
      lastSeen: null
    })
    db.upsertConversation({
      id: `dm_${targetUserId}`,
      recipientId: targetUserId,
      recipientName: targetUsername,
      recipientAvatarColor: targetAvatar,
      recipientStatus: 'offline',
      unreadCount: 0
    })
    db.removeFriendRequest(req.id)

    socketClient.emitSignaling('friend-request:accept', {
      requestId: req.id,
      fromUserId: payload.selfUserId,
      fromUsername: payload.selfUsername,
      fromAvatarColor: payload.selfAvatarColor,
      toUserId: req.fromUserId
    })
    return { success: true, friend: { userId: targetUserId, username: targetUsername, avatarColor: targetAvatar } }
  })

  // Reject an incoming request. Payload: { requestId, selfUserId }
  ipcMain.handle('friend-request:reject', async (_e, payload: { requestId: string; selfUserId: string }) => {
    const all = db.getFriendRequests()
    const req = all.find((r) => r.id === payload.requestId)
    if (!req) return { success: false, error: 'Request not found.' }
    db.removeFriendRequest(req.id)
    
    // Silently notify the original sender so they can clear their pending outgoing UI
    socketClient.emitSignaling('friend-request:reject', {
      requestId: req.id,
      fromUserId: payload.selfUserId,
      toUserId: req.fromUserId
    })

    return { success: true }
  })

  // Cancel our outgoing request. Payload: { requestId, selfUserId }
  ipcMain.handle('friend-request:cancel', async (_e, payload: { requestId: string; selfUserId: string }) => {
    const all = db.getFriendRequests()
    const req = all.find((r) => r.id === payload.requestId)
    if (!req) return { success: false, error: 'Request not found.' }
    if (req.direction !== 'outgoing') return { success: false, error: 'Not an outgoing request.' }
    db.removeFriendRequest(req.id)
    socketClient.emitSignaling('friend-request:cancel', {
      requestId: req.id,
      fromUserId: payload.selfUserId,
      toUserId: req.toUserId
    })
    return { success: true }
  })

  // Called by renderer when we receive `friend-request:incoming` from signaling.
  // Persists the request so it survives relaunch.
  ipcMain.handle('friend-request:receive', async (_e, payload: {
    id: string
    fromUserId: string
    fromUsername: string
    fromAvatarColor: string | null
    toUserId: string
    timestamp: number
  }) => {
    // Drop if blocked
    if (db.findBlocked(payload.fromUserId)) return { success: false, error: 'blocked' }
    // Already friends? The sender is re-publishing an outgoing request they
    // think is still pending — which happens when our earlier accept never
    // reached them (it was queued on a host they never rejoined). Heal their
    // side by re-firing an accept so they flip to friend too, instead of
    // silently dropping and leaving them stuck forever.
    if (db.findFriend(payload.fromUserId)) {
      const self = identity.loadIdentity()
      if (self) {
        socketClient.emitSignaling('friend-request:accept', {
          requestId: payload.id,
          fromUserId: payload.toUserId,
          fromUsername: self.username,
          fromAvatarColor: self.avatarColor,
          toUserId: payload.fromUserId
        })
      }
      return { success: false, error: 'already-friend' }
    }

    const existing = db.findFriendRequestBetween(payload.fromUserId, payload.toUserId)
    if (existing) {
      // Mutual-request collision: we already sent an outgoing to this sender.
      // Auto-promote to friend and fire back an accept so both sides flip to
      // friend in one step instead of getting stuck on both sides.
      if (existing.direction === 'outgoing' && existing.toUserId === payload.fromUserId) {
        db.addFriend({
          userId: payload.fromUserId,
          username: payload.fromUsername,
          avatarColor: payload.fromAvatarColor,
          status: 'online',
          lastSeen: Date.now()
        })
        db.upsertConversation({
          id: `dm_${payload.fromUserId}`,
          recipientId: payload.fromUserId,
          recipientName: payload.fromUsername,
          recipientAvatarColor: payload.fromAvatarColor,
          recipientStatus: 'online',
          unreadCount: 0
        })
        db.removeFriendRequest(existing.id)
        const self = identity.loadIdentity()
        socketClient.emitSignaling('friend-request:accept', {
          requestId: existing.id,
          fromUserId: payload.toUserId,
          fromUsername: self?.username ?? '',
          fromAvatarColor: self?.avatarColor ?? null,
          toUserId: payload.fromUserId
        })
        return {
          success: true,
          autoAccepted: true,
          friend: {
            userId: payload.fromUserId,
            username: payload.fromUsername,
            avatarColor: payload.fromAvatarColor
          }
        }
      }
      return { success: false, error: 'duplicate' }
    }

    db.addFriendRequest({
      id: payload.id,
      fromUserId: payload.fromUserId,
      fromUsername: payload.fromUsername,
      fromAvatarColor: payload.fromAvatarColor,
      toUserId: payload.toUserId,
      toUsername: '',
      toAvatarColor: null,
      timestamp: payload.timestamp,
      direction: 'incoming'
    })
    return { success: true }
  })

  // Called by renderer when we receive `friend-request:accepted` (i.e. our outgoing was accepted).
  // Promotes outgoing request → friend + conversation.
  ipcMain.handle('friend-request:accepted-remote', async (_e, payload: {
    requestId: string
    fromUserId: string
    fromUsername: string
    fromAvatarColor: string | null
    toUserId: string
  }) => {
    const all = db.getFriendRequests()
    const req = all.find((r) => r.id === payload.requestId)
    if (req) db.removeFriendRequest(req.id)

    db.addFriend({
      userId: payload.fromUserId,
      username: payload.fromUsername,
      avatarColor: payload.fromAvatarColor,
      status: 'online',
      lastSeen: Date.now()
    })
    db.upsertConversation({
      id: `dm_${payload.fromUserId}`,
      recipientId: payload.fromUserId,
      recipientName: payload.fromUsername,
      recipientAvatarColor: payload.fromAvatarColor,
      recipientStatus: 'online',
      unreadCount: 0
    })
    return { success: true, friend: { userId: payload.fromUserId, username: payload.fromUsername, avatarColor: payload.fromAvatarColor } }
  })

  // Called by renderer when we receive `friend-request:cancelled` from signaling.
  // Removes the incoming request that the sender cancelled.
  ipcMain.handle('friend-request:cancelled-remote', async (_e, payload: { requestId: string }) => {
    db.removeFriendRequest(payload.requestId)
    return { success: true }
  })

  // Called by renderer when we receive `friend-request:rejected` from signaling.
  // Silently removes our outgoing request without notifying the user.
  ipcMain.handle('friend-request:rejected-remote', async (_e, payload: { requestId: string }) => {
    db.removeFriendRequest(payload.requestId)
    return { success: true }
  })

  // Re-emit every still-pending OUTGOING request. Friend requests are delivered
  // (or queued) on whichever host the sender was connected to; if the recipient
  // never joined that host, the request is stranded and the sender's dedup
  // guard blocks a manual re-send — leaving both sides unable to friend, accept,
  // or call each other. Re-publishing on every (re)connect means the request is
  // redelivered the moment both parties share a host, self-healing the state.
  ipcMain.handle('friend-request:republish-pending', async () => {
    const outgoing = db.getFriendRequests().filter((r) => r.direction === 'outgoing')
    for (const r of outgoing) {
      socketClient.emitSignaling('friend-request:send', {
        id: r.id,
        fromUserId: r.fromUserId,
        fromUsername: r.fromUsername,
        fromAvatarColor: r.fromAvatarColor,
        toUserId: r.toUserId,
        timestamp: r.timestamp
      })
    }
    return { success: true, count: outgoing.length }
  })
}

/**
 * Register message-request orchestration IPC handlers.
 */
export function registerMessageRequestHandlers(): void {
  // Send a cold first-message OR a follow-up. Handles both initial send and reply.
  // Payload: { fromUserId, fromUsername, fromAvatarColor, toUserId, content, timestamp }
  ipcMain.handle('message-request:send', async (_e, payload: {
    fromUserId: string
    fromUsername: string
    fromAvatarColor: string | null
    toUserId: string
    content: string
    timestamp: number
  }) => {
    // Validation
    if (payload.fromUserId === payload.toUserId) {
      return { success: false, error: 'Cannot message yourself.' }
    }
    if (db.findBlocked(payload.toUserId)) {
      return { success: false, error: 'This user is blocked.' }
    }
    if (db.findFriend(payload.toUserId)) {
      return { success: false, error: 'Already friends — use DM instead.' }
    }

    const existing = db.findMessageRequestByOther(payload.toUserId)
    let requestId: string
    let isFirst = false

    if (!existing) {
      // First cold message → create outgoing request pending
      requestId = `mreq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      isFirst = true
      db.addMessageRequest({
        id: requestId,
        fromUserId: payload.fromUserId,
        fromUsername: payload.fromUsername,
        fromAvatarColor: payload.fromAvatarColor,
        toUserId: payload.toUserId,
        toUsername: '',
        toAvatarColor: null,
        messagePreview: payload.content.slice(0, 200),
        timestamp: payload.timestamp,
        direction: 'outgoing',
        status: 'pending'
      })
    } else {
      requestId = existing.id
      // Block if ignored or if it's our outgoing and they haven't replied yet
      if (existing.status === 'ignored') {
        return { success: false, error: 'Recipient has not replied yet.' }
      }
      if (existing.direction === 'outgoing' && existing.status === 'pending') {
        return { success: false, error: 'Wait for the recipient to reply first.' }
      }
      // Update preview + timestamp so list sorts correctly
      db.updateMessageRequestStatus(requestId, existing.status, payload.content.slice(0, 200), payload.timestamp)
    }

    const messageId = `mrm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    db.insertMessageRequestMessage({
      id: messageId,
      otherUserId: payload.toUserId,
      senderId: payload.fromUserId,
      senderName: payload.fromUsername,
      content: payload.content,
      timestamp: payload.timestamp,
      status: 'sent'
    })

    if (isFirst) {
      socketClient.emitSignaling('message-request:send', {
        requestId,
        messageId,
        fromUserId: payload.fromUserId,
        fromUsername: payload.fromUsername,
        fromAvatarColor: payload.fromAvatarColor,
        toUserId: payload.toUserId,
        content: payload.content,
        timestamp: payload.timestamp
      })
    } else {
      socketClient.emitSignaling('message-request:message', {
        messageId,
        fromUserId: payload.fromUserId,
        fromUsername: payload.fromUsername,
        toUserId: payload.toUserId,
        content: payload.content,
        timestamp: payload.timestamp,
        isReply: existing?.direction === 'incoming'
      })
    }

    return { success: true, requestId, messageId }
  })

  // Receive a cold first-message (inbound). Persists as incoming request pending.
  ipcMain.handle('message-request:receive', async (_e, payload: {
    requestId: string
    messageId: string
    fromUserId: string
    fromUsername: string
    fromAvatarColor: string | null
    toUserId: string
    content: string
    timestamp: number
  }) => {
    if (db.findBlocked(payload.fromUserId)) return { success: false, error: 'blocked' }
    if (db.findFriend(payload.fromUserId)) return { success: false, error: 'already-friend' }

    const existing = db.findMessageRequestByOther(payload.fromUserId)
    if (!existing) {
      db.addMessageRequest({
        id: payload.requestId,
        fromUserId: payload.fromUserId,
        fromUsername: payload.fromUsername,
        fromAvatarColor: payload.fromAvatarColor,
        toUserId: payload.toUserId,
        toUsername: '',
        toAvatarColor: null,
        messagePreview: payload.content.slice(0, 200),
        timestamp: payload.timestamp,
        direction: 'incoming',
        status: 'pending'
      })
    } else {
      // Update preview/timestamp; keep existing status
      db.updateMessageRequestStatus(existing.id, existing.status, payload.content.slice(0, 200), payload.timestamp)
    }

    db.insertMessageRequestMessage({
      id: payload.messageId,
      otherUserId: payload.fromUserId,
      senderId: payload.fromUserId,
      senderName: payload.fromUsername,
      content: payload.content,
      timestamp: payload.timestamp,
      status: 'delivered'
    })
    return { success: true }
  })

  // Receive a follow-up message in an existing thread (inbound).
  ipcMain.handle('message-request:message-remote', async (_e, payload: {
    messageId: string
    fromUserId: string
    fromUsername: string
    toUserId: string
    content: string
    timestamp: number
    isReply: boolean
  }) => {
    if (db.findBlocked(payload.fromUserId)) return { success: false, error: 'blocked' }
    const existing = db.findMessageRequestByOther(payload.fromUserId)
    if (!existing) return { success: false, error: 'no-thread' }

    // If remote is replying to our outgoing → promote status to 'replied'
    if (existing.direction === 'outgoing' && payload.isReply) {
      db.updateMessageRequestStatus(existing.id, 'replied', payload.content.slice(0, 200), payload.timestamp)
      // Our outgoing just got a reply — promote to real DM conversation so
      // the thread shows up in the main DM list on the sender side too.
      const otherName = existing.toUsername || payload.fromUsername || payload.fromUserId
      db.upsertConversation({
        id: `dm_${payload.fromUserId}`,
        recipientId: payload.fromUserId,
        recipientName: otherName,
        recipientAvatarColor: existing.toAvatarColor,
        recipientStatus: 'online',
        unreadCount: 0
      })
    } else {
      db.updateMessageRequestStatus(existing.id, existing.status, payload.content.slice(0, 200), payload.timestamp)
    }

    db.insertMessageRequestMessage({
      id: payload.messageId,
      otherUserId: payload.fromUserId,
      senderId: payload.fromUserId,
      senderName: payload.fromUsername,
      content: payload.content,
      timestamp: payload.timestamp,
      status: 'delivered'
    })
    return { success: true }
  })

  // Reply — same as send follow-up, but explicitly flips an incoming-pending to replied.
  ipcMain.handle('message-request:reply', async (_e, payload: {
    selfUserId: string
    selfUsername: string
    selfAvatarColor: string | null
    otherUserId: string
    content: string
    timestamp: number
  }) => {
    const existing = db.findMessageRequestByOther(payload.otherUserId)
    if (!existing) return { success: false, error: 'No thread.' }

    db.updateMessageRequestStatus(existing.id, 'replied', payload.content.slice(0, 200), payload.timestamp)

    const messageId = `mrm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    db.insertMessageRequestMessage({
      id: messageId,
      otherUserId: payload.otherUserId,
      senderId: payload.selfUserId,
      senderName: payload.selfUsername,
      content: payload.content,
      timestamp: payload.timestamp,
      status: 'sent'
    })

    // Promote the request into a real DM conversation so the thread carries
    // forward into the normal DM list (no duplicate instance later). The
    // upsert dedupes via ON CONFLICT(id) so subsequent replies are a no-op.
    const otherName =
      existing.direction === 'incoming'
        ? existing.fromUsername
        : (existing.toUsername || payload.otherUserId)
    const otherAvatar =
      existing.direction === 'incoming' ? existing.fromAvatarColor : existing.toAvatarColor
    db.upsertConversation({
      id: `dm_${payload.otherUserId}`,
      recipientId: payload.otherUserId,
      recipientName: otherName,
      recipientAvatarColor: otherAvatar,
      recipientStatus: 'offline',
      unreadCount: 0
    })

    socketClient.emitSignaling('message-request:message', {
      messageId,
      fromUserId: payload.selfUserId,
      fromUsername: payload.selfUsername,
      toUserId: payload.otherUserId,
      content: payload.content,
      timestamp: payload.timestamp,
      isReply: existing.direction === 'incoming'
    })
    return { success: true, messageId }
  })

  // Ignore an incoming request — keeps row but blocks further sends until recipient replies.
  ipcMain.handle('message-request:ignore', async (_e, payload: { requestId: string }) => {
    db.updateMessageRequestStatus(payload.requestId, 'ignored')
    return { success: true }
  })

  // Block from a message request — removes the thread and blocks the user.
  ipcMain.handle('message-request:block', async (_e, payload: { otherUserId: string; otherUsername: string }) => {
    db.deleteMessageRequestThread(payload.otherUserId)
    db.blockUser(payload.otherUserId, payload.otherUsername)
    return { success: true }
  })

  // Fetch thread messages.
  ipcMain.handle('message-request:thread', (_e, otherUserId: string) => {
    return db.getMessageRequestThread(otherUserId)
  })
}

/**
 * Register community-server orchestration IPC handlers.
 */
// Password hash supplied with the most recent join attempt per server —
// persisted into the local row on join-ack so auto-rejoin can reuse it.
const pendingJoinPasswords = new Map<string, string | null>()

/** The full channel layout for a server, as broadcast to members. */
function buildServerLayout(serverId: string): { categories: unknown[]; channels: unknown[] } {
  return {
    categories: db.getServerCategories(serverId),
    channels: db.getServerChannels(serverId)
  }
}

export function registerServerHandlers(): void {
  // Create a new server (I am the host). Persists locally + registers with signaling.
  ipcMain.handle('server:create', async (_e, payload: {
    name: string
    iconColor: string
    hostUserId: string
    hostUsername: string
    hostAvatarColor: string | null
    passwordHash?: string | null
  }) => {
    const hex = Array.from(new Uint8Array(8).map(() => Math.floor(Math.random() * 256)))
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    const serverId = `srv_${hex}`

    const row: ServerRow = {
      id: serverId,
      name: payload.name,
      iconColor: payload.iconColor,
      role: 'host',
      textChannelName: 'general',
      voiceRoomName: 'Voice Lounge',
      memberCount: 1,
      onlineMemberCount: 1,
      hostUserId: payload.hostUserId,
      hostUsername: payload.hostUsername,
      hostAvatarColor: payload.hostAvatarColor,
      banned: '[]',
      passwordHash: payload.passwordHash
    }
    db.addServer(row)
    db.addServerMember({
      serverId,
      userId: payload.hostUserId,
      username: payload.hostUsername,
      avatarColor: payload.hostAvatarColor,
      role: 'host',
      status: 'online',
      isMuted: 0,
      roleIds: '[]'
    })
    // Seed default category/channel pair so the new server has the same
    // shape as migrated legacy servers.
    db.seedDefaultServerChannelsIfMissing()

    socketClient.emitSignaling('server:register', {
      serverId,
      name: payload.name,
      iconColor: payload.iconColor,
      avatarDataUrl: serverAvatar.getServerAvatarDataUrl(serverId),
      textChannelName: row.textChannelName,
      voiceRoomName: row.voiceRoomName,
      hostUserId: payload.hostUserId,
      hostUsername: payload.hostUsername,
      hostAvatarColor: payload.hostAvatarColor,
      members: [{
        userId: payload.hostUserId,
        username: payload.hostUsername,
        avatarColor: payload.hostAvatarColor,
        role: 'host',
        isMuted: false
      }],
      banned: [],
      passwordHash: payload.passwordHash,
      layout: buildServerLayout(serverId),
      roleNames: null,
      roles: []
    })

    return { success: true, serverId }
  })

  // ── Custom roles (Discord-style) ──

  function isHostOf(serverId: string, actorId: string): boolean {
    const srv = db.getServer(serverId)
    return !!srv && srv.hostUserId === actorId
  }

  function broadcastRoles(serverId: string): void {
    socketClient.emitSignaling('server:roles-update', {
      serverId,
      roles: db.getServerRoles(serverId)
    })
  }

  ipcMain.handle('server:list-roles', async (_e, payload: { serverId: string }) => {
    return db.getServerRoles(payload.serverId)
  })

  ipcMain.handle('server:create-role', async (_e, payload: {
    serverId: string
    actorId: string
    name: string
    color: string
    permissions: number
  }) => {
    if (!isHostOf(payload.serverId, payload.actorId) && !actorHasPerm(payload.serverId, payload.actorId, PERM.manageRoles)) {
      return { success: false, error: 'forbidden' }
    }
    const existing = db.getServerRoles(payload.serverId)
    const id = `${payload.serverId}__role-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const permissions = Number.isFinite(payload.permissions) ? payload.permissions : 0
    db.insertServerRole({
      id,
      serverId: payload.serverId,
      name: (payload.name || 'new role').slice(0, 32),
      color: payload.color || '#9b9ba3',
      position: existing.length,
      canModerate: (permissions & MODERATOR_BUNDLE) !== 0 ? 1 : 0,
      permissions
    })
    broadcastRoles(payload.serverId)
    return { success: true, roleId: id }
  })

  ipcMain.handle('server:update-role', async (_e, payload: {
    serverId: string
    actorId: string
    roleId: string
    name: string
    color: string
    permissions: number
  }) => {
    if (!isHostOf(payload.serverId, payload.actorId) && !actorHasPerm(payload.serverId, payload.actorId, PERM.manageRoles)) {
      return { success: false, error: 'forbidden' }
    }
    const existing = db.getServerRoles(payload.serverId).find((r) => r.id === payload.roleId)
    if (!existing) return { success: false, error: 'not found' }
    const permissions = Number.isFinite(payload.permissions) ? payload.permissions : existing.permissions
    db.insertServerRole({
      ...existing,
      name: (payload.name || existing.name).slice(0, 32),
      color: payload.color || existing.color,
      canModerate: (permissions & MODERATOR_BUNDLE) !== 0 ? 1 : 0,
      permissions
    })
    broadcastRoles(payload.serverId)
    return { success: true }
  })

  ipcMain.handle('server:delete-role', async (_e, payload: {
    serverId: string
    actorId: string
    roleId: string
  }) => {
    if (!isHostOf(payload.serverId, payload.actorId) && !actorHasPerm(payload.serverId, payload.actorId, PERM.manageRoles)) {
      return { success: false, error: 'forbidden' }
    }
    db.deleteServerRole(payload.serverId, payload.roleId)
    broadcastRoles(payload.serverId)
    emitLayoutUpdate(payload.serverId) // channel allow-lists may have changed
    // Re-broadcast affected members' (now scrubbed) assignments.
    for (const m of db.getServerMembers(payload.serverId)) {
      socketClient.emitSignaling('server:member-roles-update', {
        serverId: payload.serverId,
        userId: m.userId,
        roleIds: JSON.parse(m.roleIds || '[]')
      })
    }
    return { success: true }
  })

  // Assign/unassign custom roles on a member. Requires Manage Roles;
  // nobody can edit the host's assignments except the host.
  ipcMain.handle('server:assign-member-roles', async (_e, payload: {
    serverId: string
    actorId: string
    targetId: string
    roleIds: string[]
  }) => {
    if (!actorHasPerm(payload.serverId, payload.actorId, PERM.manageRoles)) return { success: false, error: 'forbidden' }
    const srv = db.getServer(payload.serverId)
    if (srv && srv.hostUserId === payload.targetId && payload.actorId !== payload.targetId) {
      return { success: false, error: 'forbidden' }
    }
    const valid = new Set(db.getServerRoles(payload.serverId).map((r) => r.id))
    const roleIds = (Array.isArray(payload.roleIds) ? payload.roleIds : []).filter((id) => valid.has(id))
    db.updateMemberRoleIds(payload.serverId, payload.targetId, JSON.stringify(roleIds))
    socketClient.emitSignaling('server:member-roles-update', {
      serverId: payload.serverId,
      userId: payload.targetId,
      roleIds
    })
    return { success: true }
  })

  // Member side: adopt broadcasts. Guarded so echoes never touch hosted servers.
  ipcMain.handle('server:apply-roles', async (_e, payload: { serverId: string; roles: unknown }) => {
    const srv = db.getServer(payload.serverId)
    if (!srv || srv.role === 'host') return { success: false }
    if (!Array.isArray(payload.roles)) return { success: false }
    db.replaceServerRoles(
      payload.serverId,
      (payload.roles as import('../shared/types').ServerRoleRow[]).map((r) => ({
        ...r,
        canModerate: r.canModerate ? 1 : 0,
        permissions: Number.isFinite(r.permissions) ? r.permissions : 0
      }))
    )
    return { success: true }
  })

  ipcMain.handle('server:apply-member-roles', async (_e, payload: { serverId: string; userId: string; roleIds: string[] }) => {
    db.updateMemberRoleIds(
      payload.serverId,
      payload.userId,
      JSON.stringify(Array.isArray(payload.roleIds) ? payload.roleIds : [])
    )
    return { success: true }
  })

  // Restrict a channel to specific custom roles (null/empty = everyone).
  ipcMain.handle('server:set-channel-roles', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
    allowedRoleIds: string[] | null
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    const ids = Array.isArray(payload.allowedRoleIds) ? payload.allowedRoleIds : null
    db.updateServerChannelRoles(payload.channelId, ids && ids.length > 0 ? JSON.stringify(ids) : null)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })

  // Rename the role tiers for a server (display names only).
  ipcMain.handle('server:set-role-names', async (_e, payload: {
    serverId: string
    actorId: string
    roleNames: { host: string; moderator: string; member: string } | null
  }) => {
    const srv = db.getServer(payload.serverId)
    if (!srv) return { success: false, error: 'not found' }
    if (srv.hostUserId !== payload.actorId && !actorHasPerm(payload.serverId, payload.actorId, PERM.manageServer)) {
      return { success: false, error: 'forbidden' }
    }
    db.updateServerRoleNames(payload.serverId, payload.roleNames ? JSON.stringify(payload.roleNames) : null)
    socketClient.emitSignaling('server:role-names-update', {
      serverId: payload.serverId,
      roleNames: payload.roleNames
    })
    return { success: true }
  })

  // Member side: adopt the host's role names. Never touches hosted servers.
  ipcMain.handle('server:apply-role-names', async (_e, payload: {
    serverId: string
    roleNames: { host?: string; moderator?: string; member?: string } | null
  }) => {
    const srv = db.getServer(payload.serverId)
    if (!srv || srv.role === 'host') return { success: false }
    db.updateServerRoleNames(payload.serverId, payload.roleNames ? JSON.stringify(payload.roleNames) : null)
    return { success: true }
  })

  ipcMain.handle('server:requires-password', async (_e, payload: { serverId: string }) => {
    const srv = db.getServer(payload.serverId)
    if (!srv) return false
    return !!srv.passwordHash
  })

  // Join an existing server. Sends join-request via signaling; final state lands via event.
  ipcMain.handle('server:join', async (_e, payload: {
    serverId: string
    userId: string
    username: string
    avatarColor: string | null
    passwordHash?: string | null
  }) => {
    // Local check removed. Authentication is strictly handled remotely by the signaling server
    // so we don't accidentally bypass password rules for un-cached servers.
    if (!socketClient.isConnected()) {
      return { success: false, error: 'Not connected to signaling server. Check your network settings.' }
    }
    // Remember the hash so join-ack-persist can store it — needed for silent
    // auto-rejoin of password servers after a reconnect.
    pendingJoinPasswords.set(payload.serverId, payload.passwordHash ?? null)
    socketClient.emitSignaling('server:join', payload)
    return { success: true }
  })

  // Called by renderer when join-ack arrives: persist server + members locally.
  ipcMain.handle('server:join-ack-persist', async (_e, payload: {
    server: {
      id: string
      name: string
      iconColor: string
      textChannelName: string
      voiceRoomName: string
      hostUserId: string
      hostUsername: string
      hostAvatarColor: string | null
      avatarDataUrl?: string | null
      roleNames?: { host?: string; moderator?: string; member?: string } | null
    }
    members: Array<{ userId: string; username: string; avatarColor: string | null; role: string; isMuted: boolean; roleIds?: string[] }>
    roles?: unknown[]
    yourRole: string
  }) => {
    // Validate payload structure to prevent crashes
    if (!payload || !payload.server || !payload.server.id) {
      console.error('[server:join-ack-persist] Invalid payload:', payload)
      return { success: false, error: 'Invalid server join response' }
    }

    try {
      db.addServer({
        id: payload.server.id,
        name: payload.server.name,
        iconColor: payload.server.iconColor,
        role: payload.yourRole,
        textChannelName: payload.server.textChannelName,
        voiceRoomName: payload.server.voiceRoomName,
        memberCount: payload.members.length,
        onlineMemberCount: payload.members.length,
        hostUserId: payload.server.hostUserId,
        hostUsername: payload.server.hostUsername,
        hostAvatarColor: payload.server.hostAvatarColor,
        banned: '[]',
        passwordHash: pendingJoinPasswords.get(payload.server.id) ?? null,
        roleNames: payload.server.roleNames ? JSON.stringify(payload.server.roleNames) : null
      })
      if (payload.server.avatarDataUrl) {
        serverAvatar.saveServerAvatarDataUrl(payload.server.id, payload.server.avatarDataUrl)
      }
      // Replace member list: remove stale, then add current.
      const existing = db.getServerMembers(payload.server.id)
      for (const m of existing) db.removeServerMember(payload.server.id, m.userId)
      for (const m of payload.members) {
        db.addServerMember({
          serverId: payload.server.id,
          userId: m.userId,
          username: m.username,
          avatarColor: m.avatarColor,
          role: m.role,
          status: 'online',
          isMuted: m.isMuted ? 1 : 0,
          roleIds: JSON.stringify((m as { roleIds?: string[] }).roleIds ?? [])
        })
      }
      // Adopt the host's custom role definitions.
      if (Array.isArray(payload.roles)) {
        db.replaceServerRoles(
          payload.server.id,
          (payload.roles as import('../shared/types').ServerRoleRow[]).map((r) => ({
            ...r,
            canModerate: r.canModerate ? 1 : 0
          }))
        )
      }
      console.log('[server:join-ack-persist] Successfully joined server:', payload.server.id)
      return { success: true }
    } catch (err) {
      console.error('[server:join-ack-persist] Failed to persist:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Leave a server (both host and members can call).
  ipcMain.handle('server:leave', async (_e, payload: { serverId: string; userId: string; destroy?: boolean }) => {
    socketClient.emitSignaling('server:leave', payload)
    db.removeServer(payload.serverId)
    if (payload.destroy) {
      // Cascade delete members and messages locally
      const mems = db.getServerMembers(payload.serverId)
      for (const m of mems) {
        db.removeServerMember(payload.serverId, m.userId)
      }
      // db.ts doesn't have a specific `deleteServerMessagesForServer` but we can remove it from local view via cascade in sqlite, or just remove server record. 
    }
    return { success: true }
  })

  // Send a text (or file) message in a server. File payloads carry base64 in
  // the signaling broadcast so every member receives the actual bytes — the
  // old path stuffed a data-URL into the content string for images only and
  // reduced every other file to a "[File: ...]" placeholder.
  ipcMain.handle('server:send-message', async (_e, payload: {
    serverId: string
    senderId: string
    senderName: string
    content: string
    channelId?: string | null
    file?: { fileId: string; fileName: string; fileSize: number; fileType: string; base64: string; filePath?: string | null } | null
  }) => {
    // Permission gates. With a channel context the channel-override resolver
    // is authoritative (overrides can grant beyond server-level, Discord
    // semantics); otherwise fall back to the server-level bits.
    if (payload.channelId) {
      const ch = db.getServerChannel(payload.channelId)
      if (ch) {
        const me = db.getServerMembers(payload.serverId).find((m) => m.userId === payload.senderId)
        const parseArr = (raw: string | null): string[] | null => {
          if (!raw) return null
          try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null } catch { return null }
        }
        let overrides: import('../shared/permissions').ChannelOverrides | null = null
        try { overrides = ch.permissionOverrides ? JSON.parse(ch.permissionOverrides) : null } catch { /* none */ }
        let myRoleIds: string[] = []
        try { myRoleIds = JSON.parse(me?.roleIds || '[]') } catch { /* default */ }
        const common = {
          tier: me?.role ?? 'member',
          roleIds: myRoleIds,
          roles: db.getServerRoles(payload.serverId),
          overrides,
          minRole: ch.minRole,
          allowedRoleIds: parseArr(ch.allowedRoleIds),
          sendRoleIds: parseArr(ch.sendRoleIds)
        }
        if (!resolveChannelPerm({ ...common, key: 'sendMessages' })) {
          return { success: false, error: 'You do not have permission to send messages in this channel.' }
        }
        if (payload.file && !resolveChannelPerm({ ...common, key: 'attachFiles' })) {
          return { success: false, error: 'You do not have permission to attach files in this channel.' }
        }
      }
    } else {
      if (!actorHasPerm(payload.serverId, payload.senderId, PERM.sendMessages)) {
        return { success: false, error: 'You do not have permission to send messages here.' }
      }
      if (payload.file && !actorHasPerm(payload.serverId, payload.senderId, PERM.attachFiles)) {
        return { success: false, error: 'You do not have permission to attach files here.' }
      }
    }
    // Renderer only passes content + sender info — we mint the id/timestamp here
    // so every message has non-null primary key + timestamp columns.
    const id = `smsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const timestamp = Date.now()
    db.insertServerMessage({
      id,
      serverId: payload.serverId,
      senderId: payload.senderId,
      senderName: payload.senderName,
      content: payload.content,
      timestamp,
      status: 'sent',
      channelId: payload.channelId ?? null,
      fileId: payload.file?.fileId ?? null,
      fileName: payload.file?.fileName ?? null,
      fileSize: payload.file?.fileSize ?? null,
      fileType: payload.file?.fileType ?? null,
      filePath: payload.file?.filePath ?? null,
      editedAt: null,
      isDeleted: 0,
      reactions: '{}'
    })
    socketClient.emitSignaling('server:message', {
      serverId: payload.serverId,
      message: {
        id,
        senderId: payload.senderId,
        senderName: payload.senderName,
        content: payload.content,
        timestamp,
        channelId: payload.channelId ?? null,
        file: payload.file
          ? {
              fileId: payload.file.fileId,
              fileName: payload.file.fileName,
              fileSize: payload.file.fileSize,
              fileType: payload.file.fileType,
              base64: payload.file.base64
            }
          : null
      }
    })
    return { success: true, messageId: id }
  })

  // Called by renderer when server:message event arrives — persist inbound.
  // For file messages the renderer saves the bytes first and passes the
  // resulting local filePath so history renders after restart.
  ipcMain.handle('server:message-remote', async (_e, payload: {
    serverId: string
    message: {
      id: string; senderId: string; senderName: string; content: string; timestamp: number; channelId?: string | null
      file?: { fileId: string; fileName: string; fileSize: number; fileType: string; filePath?: string | null } | null
    }
  }) => {
    db.insertServerMessage({
      id: payload.message.id,
      serverId: payload.serverId,
      senderId: payload.message.senderId,
      senderName: payload.message.senderName,
      content: payload.message.content,
      timestamp: payload.message.timestamp,
      status: 'delivered',
      channelId: payload.message.channelId ?? null,
      fileId: payload.message.file?.fileId ?? null,
      fileName: payload.message.file?.fileName ?? null,
      fileSize: payload.message.file?.fileSize ?? null,
      fileType: payload.message.file?.fileType ?? null,
      filePath: payload.message.file?.filePath ?? null,
      editedAt: null,
      isDeleted: 0,
      reactions: '{}'
    })
    return { success: true }
  })

  // Moderation: emit + persist locally (each client also persists on event receipt).
  ipcMain.handle('server:mute', async (_e, payload: { serverId: string; actorId: string; targetId: string; mute: boolean }) => {
    socketClient.emitSignaling('server:mute', payload)
    return { success: true }
  })
  ipcMain.handle('server:kick', async (_e, payload: { serverId: string; actorId: string; targetId: string }) => {
    socketClient.emitSignaling('server:kick', payload)
    return { success: true }
  })
  ipcMain.handle('server:ban', async (_e, payload: { serverId: string; actorId: string; targetId: string }) => {
    socketClient.emitSignaling('server:ban', payload)
    // Persist locally on host side.
    const srv = db.getServer(payload.serverId)
    if (srv) {
      const banned: string[] = JSON.parse(srv.banned || '[]')
      if (!banned.includes(payload.targetId)) {
        banned.push(payload.targetId)
        db.updateServerBanned(payload.serverId, JSON.stringify(banned))
      }
    }
    return { success: true }
  })
  ipcMain.handle('server:set-role', async (_e, payload: { serverId: string; actorId: string; targetId: string; role: 'moderator' | 'member' }) => {
    socketClient.emitSignaling('server:set-role', payload)
    return { success: true }
  })

  // Apply a moderation event to local state (called by renderer on event receipt).
  ipcMain.handle('server:apply-moderation', async (_e, payload: {
    kind: 'muted' | 'kicked' | 'banned' | 'role-changed'
    serverId: string
    userId: string
    role?: 'moderator' | 'member'
    mute?: boolean
  }) => {
    if (payload.kind === 'muted') {
      db.updateServerMemberMuted(payload.serverId, payload.userId, payload.mute ? 1 : 0)
    } else if (payload.kind === 'kicked' || payload.kind === 'banned') {
      db.removeServerMember(payload.serverId, payload.userId)
      if (payload.kind === 'banned') {
        const srv = db.getServer(payload.serverId)
        if (srv) {
          const banned: string[] = JSON.parse(srv.banned || '[]')
          if (!banned.includes(payload.userId)) {
            banned.push(payload.userId)
            db.updateServerBanned(payload.serverId, JSON.stringify(banned))
          }
        }
      }
    } else if (payload.kind === 'role-changed' && payload.role) {
      db.updateServerMemberRole(payload.serverId, payload.userId, payload.role)
    }
    return { success: true }
  })

  // Member joined event → persist.
  ipcMain.handle('server:member-joined-persist', async (_e, payload: {
    serverId: string
    member: { userId: string; username: string; avatarColor: string | null; role: string; isMuted: boolean }
  }) => {
    db.addServerMember({
      serverId: payload.serverId,
      userId: payload.member.userId,
      username: payload.member.username,
      avatarColor: payload.member.avatarColor,
      role: payload.member.role,
      status: 'online',
      isMuted: payload.member.isMuted ? 1 : 0,
      roleIds: JSON.stringify((payload.member as { roleIds?: string[] }).roleIds ?? [])
    })
    return { success: true }
  })

  // We (self) got kicked/banned → delete local server state.
  ipcMain.handle('server:remove-local', async (_e, payload: { serverId: string }) => {
    db.removeServer(payload.serverId)
    return { success: true }
  })

  // Re-register my hosted servers on signaling (e.g. after reconnect).
  ipcMain.handle('server:reregister-mine', async (_e, payload: {
    selfUserId: string
    selfUsername?: string
    selfAvatarColor?: string | null
  }) => {
    const all = db.getServers().filter((s) => s.hostUserId === payload.selfUserId)
    for (const s of all) {
      const members = db.getServerMembers(s.id).map((m) => {
        let roleIds: string[] = []
        try { roleIds = JSON.parse(m.roleIds || '[]') } catch { /* default */ }
        return {
          userId: m.userId,
          username: m.username,
          avatarColor: m.avatarColor,
          role: m.role,
          isMuted: m.isMuted === 1,
          roleIds
        }
      })
      socketClient.emitSignaling('server:register', {
        serverId: s.id,
        name: s.name,
        iconColor: s.iconColor,
        avatarDataUrl: serverAvatar.getServerAvatarDataUrl(s.id),
        textChannelName: s.textChannelName,
        voiceRoomName: s.voiceRoomName,
        hostUserId: s.hostUserId,
        hostUsername: s.hostUsername,
        hostAvatarColor: s.hostAvatarColor,
        members,
        banned: JSON.parse(s.banned || '[]'),
        layout: buildServerLayout(s.id),
        roleNames: s.roleNames ? JSON.parse(s.roleNames) : null,
        roles: db.getServerRoles(s.id)
      })
    }
    // Rejoin rooms of servers where I'm a member. Send real identity info —
    // if the host's authoritative snapshot doesn't have us yet, the signaling
    // server creates our member record from THIS payload, and an empty
    // username produced blank entries in everyone's member list.
    const mine = db.getServers().filter((s) => s.hostUserId !== payload.selfUserId)
    for (const s of mine) {
      socketClient.emitSignaling('server:join', {
        serverId: s.id,
        userId: payload.selfUserId,
        username: payload.selfUsername || '',
        avatarColor: payload.selfAvatarColor ?? null,
        passwordHash: s.passwordHash ?? null
      })
    }
    return { success: true, count: all.length }
  })

  // ── Server message edit/delete ──
  ipcMain.handle('server:edit-message', async (_e, payload: {
    serverId: string
    messageId: string
    senderId: string
    content: string
  }) => {
    const editedAt = Date.now()
    db.editServerMessage(payload.messageId, payload.content, editedAt)
    socketClient.emitSignaling('server:message-edit', {
      serverId: payload.serverId,
      messageId: payload.messageId,
      senderId: payload.senderId,
      content: payload.content,
      editedAt
    })
    return { success: true, editedAt }
  })

  ipcMain.handle('server:delete-message', async (_e, payload: {
    serverId: string
    messageId: string
    actorId: string
  }) => {
    db.deleteServerMessage(payload.messageId)
    socketClient.emitSignaling('server:message-delete', payload)
    return { success: true }
  })

  // Apply remote edit/delete (received via broadcast) to local DB.
  ipcMain.handle('server:apply-message-edit', async (_e, payload: {
    serverId: string
    messageId: string
    content: string
    editedAt: number
  }) => {
    db.editServerMessage(payload.messageId, payload.content, payload.editedAt)
    return { success: true }
  })

  ipcMain.handle('server:apply-message-delete', async (_e, payload: {
    serverId: string
    messageId: string
  }) => {
    db.deleteServerMessage(payload.messageId)
    return { success: true }
  })

  // ── Channels / Categories ──────────────────────────────────────────────
  // All mutations require the actor to be host or moderator on the server.
  // For now these are local-only; multi-peer sync will piggyback on
  // existing server signaling in a follow-up.

  /** Effective permission mask for a member (see shared/permissions.ts). */
  function memberPerms(serverId: string, userId: string): number {
    const me = db.getServerMembers(serverId).find((m) => m.userId === userId)
    if (!me) return 0
    let roleIds: string[] = []
    try { roleIds = JSON.parse(me.roleIds || '[]') } catch { /* default */ }
    return effectivePermissions(me.role, roleIds, db.getServerRoles(serverId))
  }

  function actorHasPerm(serverId: string, actorId: string, perm: number): boolean {
    return hasPerm(memberPerms(serverId, actorId), perm)
  }

  function canManageServer(serverId: string, actorId: string): boolean {
    return actorHasPerm(serverId, actorId, PERM.manageChannels)
  }

  // Push the authoritative channel layout to signaling so every member's
  // client mirrors it. Called after any channel/category mutation — without
  // this, custom channels (and their role gates) only ever existed on the
  // machine that created them.
  function emitLayoutUpdate(serverId: string): void {
    socketClient.emitSignaling('server:layout-update', {
      serverId,
      layout: buildServerLayout(serverId)
    })
  }

  ipcMain.handle('server:list-channels', async (_e, payload: { serverId: string }) => {
    return {
      categories: db.getServerCategories(payload.serverId),
      channels: db.getServerChannels(payload.serverId)
    }
  })

  ipcMain.handle('server:create-category', async (_e, payload: {
    serverId: string
    actorId: string
    name: string
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    const existing = db.getServerCategories(payload.serverId)
    const position = existing.length
    const id = `${payload.serverId}__cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    db.insertServerCategory({ id, serverId: payload.serverId, name: payload.name || 'New Category', position })
    emitLayoutUpdate(payload.serverId)
    return { success: true, categoryId: id }
  })

  ipcMain.handle('server:create-channel', async (_e, payload: {
    serverId: string
    actorId: string
    name: string
    type: 'text' | 'voice'
    categoryId?: string | null
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    const existing = db.getServerChannels(payload.serverId)
    const position = existing.length
    const id = `${payload.serverId}__ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    db.insertServerChannel({
      id,
      serverId: payload.serverId,
      categoryId: payload.categoryId ?? null,
      name: payload.name || (payload.type === 'voice' ? 'voice' : 'channel'),
      type: payload.type,
      position,
      minRole: 'member',
      allowedRoleIds: null,
      bitrateKbps: null,
      userLimit: 0,
      sendRoleIds: null,
      permissionOverrides: null
    })
    emitLayoutUpdate(payload.serverId)
    return { success: true, channelId: id }
  })

  // Discord-style per-channel permission overrides (Manage Channels).
  ipcMain.handle('server:set-channel-overrides', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
    overrides: unknown | null
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    let json: string | null = null
    if (payload.overrides && typeof payload.overrides === 'object' && Object.keys(payload.overrides).length > 0) {
      json = JSON.stringify(payload.overrides)
    }
    db.updateServerChannelOverrides(payload.channelId, json)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })

  // Restrict who can see a channel (host/moderator only, host outranks all).
  ipcMain.handle('server:set-channel-access', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
    minRole: 'member' | 'moderator' | 'host'
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    db.updateServerChannelAccess(payload.channelId, payload.minRole)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })

  // Voice channel knobs: bitrate + user limit (Manage Channels).
  ipcMain.handle('server:update-channel-settings', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
    bitrateKbps: number | null
    userLimit: number
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    const bitrate = payload.bitrateKbps === null ? null : Math.max(8, Math.min(320, Math.round(payload.bitrateKbps)))
    const limit = Math.max(0, Math.min(99, Math.round(payload.userLimit)))
    db.updateServerChannelSettings(payload.channelId, bitrate, limit)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })

  // Text channel: restrict who can send (null = everyone with the global perm).
  ipcMain.handle('server:set-channel-send-roles', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
    sendRoleIds: string[] | null
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    const ids = Array.isArray(payload.sendRoleIds) ? payload.sendRoleIds : null
    db.updateServerChannelSendRoles(payload.channelId, ids && ids.length > 0 ? JSON.stringify(ids) : null)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })

  // Member side: persist the host's authoritative layout broadcast. Guarded
  // so an echoed broadcast can never clobber a server we host ourselves.
  ipcMain.handle('server:apply-layout', async (_e, payload: {
    serverId: string
    layout: { categories?: unknown[]; channels?: unknown[] } | null
  }) => {
    const srv = db.getServer(payload.serverId)
    if (!srv || srv.role === 'host') return { success: false }
    if (!payload.layout || !Array.isArray(payload.layout.categories) || !Array.isArray(payload.layout.channels)) {
      return { success: false }
    }
    db.replaceServerLayout(
      payload.serverId,
      payload.layout.categories as import('../shared/types').ServerCategoryRow[],
      (payload.layout.channels as import('../shared/types').ServerChannelRow[]).map((c) => ({
        ...c,
        minRole: c.minRole === 'host' || c.minRole === 'moderator' ? c.minRole : 'member'
      }))
    )
    return { success: true }
  })

  ipcMain.handle('server:rename-channel', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
    name: string
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    db.updateServerChannelName(payload.channelId, payload.name)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })

  ipcMain.handle('server:rename-category', async (_e, payload: {
    serverId: string
    actorId: string
    categoryId: string
    name: string
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    db.updateServerCategoryName(payload.categoryId, payload.name)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })

  ipcMain.handle('server:delete-channel', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    db.deleteServerChannel(payload.channelId)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })

  ipcMain.handle('server:delete-category', async (_e, payload: {
    serverId: string
    actorId: string
    categoryId: string
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    db.deleteServerCategory(payload.categoryId)
    emitLayoutUpdate(payload.serverId)
    return { success: true }
  })
}

/**
 * Register signaling-related IPC handlers.
 * Wires the renderer to the main-process socket.io client.
 */
export function registerSignalingHandlers(): void {
  ipcMain.handle('signaling:connect', async (_e, args: { serverUrl: string; userId: string }) => {
    return socketClient.connectToSignaling(args.serverUrl, args.userId)
  })

  ipcMain.handle('signaling:disconnect', async () => {
    return socketClient.disconnectFromSignaling()
  })

  ipcMain.handle('signaling:is-connected', () => {
    return socketClient.isConnected()
  })

  ipcMain.handle('signaling:socket-id', () => {
    return socketClient.getSocketId()
  })

  ipcMain.on('signaling:emit', (_e, event: string, ...args: unknown[]) => {
    socketClient.emitSignaling(event, ...args)
  })
}

/**
 * Register relay-manager IPC handlers.
 * Runs node-turn (pure JS TURN server) in-process — no binaries, no installs.
 */
export function registerRelayHandlers(): void {
  ipcMain.handle('relay:start', async (_e, args: { port?: number; scope?: 'isp-local' | 'global'; signalingUrl?: string }) => {
    return relayManager.startRelay(args || {})
  })

  ipcMain.handle('relay:stop', () => relayManager.stopRelay())

  ipcMain.handle('relay:status', () => relayManager.getRelayStatus())

  ipcMain.handle('relay:register', async (_e, args: { signalingUrl: string; address: string; scope: 'isp-local' | 'global' }) => {
    return relayManager.registerWithSignaling(args.signalingUrl, args.address, args.scope)
  })

  // Live relay list from the signaling server — fetched in the main process
  // because the express routes have no CORS headers, so a renderer fetch
  // would be blocked.
  ipcMain.handle('relay:fetch-remote', async (_e, args: { signalingUrl: string }) => {
    return relayManager.fetchRemoteRelays(args.signalingUrl)
  })

  ipcMain.handle('network-discovery:fetch-servers', async (_e, args: { url: string }): Promise<NetworkProbeResult> => {
    const url = normalizeSignalingUrl(args.url || '')
    if (!url) {
      return { success: false, url, latencyMs: null, servers: [], error: 'Network URL is required.' }
    }

    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(`${url}/get-servers`, { signal: controller.signal })
      const latencyMs = Date.now() - started
      if (!res.ok) {
        return { success: false, url, latencyMs, servers: [], error: `HTTP ${res.status}` }
      }
      const json = await res.json()
      const servers = Array.isArray(json)
        ? json.map(sanitizeDiscoveredServer).filter((s): s is DiscoveredServerPayload => Boolean(s))
        : []
      return { success: true, url, latencyMs, servers }
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError'
        ? 'Timed out'
        : err instanceof Error
          ? err.message
          : 'Could not reach network'
      return { success: false, url, latencyMs: Date.now() - started, servers: [], error: message }
    } finally {
      clearTimeout(timer)
    }
  })
}

/**
 * Register avatar / profile-picture IPC handlers (Task 7).
 */
export function registerAvatarHandlers(): void {
  ipcMain.handle('avatar:pick-and-set', () => avatar.pickAndSetAvatar())
  ipcMain.handle('avatar:get-self', () => avatar.getSelfAvatarDataUrl())
  ipcMain.handle('avatar:get-self-base64', () => {
    const png = avatar.getSelfAvatarPng()
    return png ? png.toString('base64') : null
  })
  ipcMain.handle('avatar:get-for-user', (_e, userId: string) => avatar.getFriendAvatarDataUrl(userId))
  ipcMain.handle('avatar:save-for-user', (_e, payload: { userId: string; base64: string }) =>
    avatar.saveFriendAvatarFromBase64(payload.userId, payload.base64)
  )
  ipcMain.handle('avatar:clear-self', () => avatar.clearSelfAvatar())

  // Server avatars — same pattern, keyed by serverId.
  ipcMain.handle('server-avatar:pick-and-set', (_e, payload: { serverId: string }) =>
    serverAvatar.pickAndSetServerAvatar(payload.serverId)
  )
  ipcMain.handle('server-avatar:get', (_e, payload: { serverId: string }) =>
    serverAvatar.getServerAvatarDataUrl(payload.serverId)
  )
  ipcMain.handle('server-avatar:get-all', () => serverAvatar.getAllServerAvatars())
  ipcMain.handle('server-avatar:clear', (_e, payload: { serverId: string }) =>
    serverAvatar.clearServerAvatar(payload.serverId)
  )
}

/**
 * Register notifications handler (Task 8).
 * Renderer decides policy (settings, focus, active convo) and only calls this
 * when it wants the native OS notification to actually appear.
 */
export function registerNotificationHandlers(): void {
  ipcMain.handle('notification:show', (_e, payload: NotifyPayload) => showNotification(payload))
}

/**
 * Register block-system IPC handlers (Task 5).
 *
 * `block:user` atomically:
 *  - inserts into blocked_users
 *  - removes the friend (if any)
 *  - deletes any pending friend_requests between the two users (either direction)
 *  - deletes any message_request thread + messages with that user
 */
export function registerBlockHandlers(): void {
  ipcMain.handle('block:user', (_e, payload: { selfUserId: string; targetUserId: string; targetUsername?: string }) => {
    const { selfUserId, targetUserId } = payload
    if (!targetUserId || targetUserId === selfUserId) return { success: false, error: 'invalid-target' }

    // Resolve a reasonable display name if not provided.
    const friend = db.findFriend(targetUserId)
    const mr = db.findMessageRequestByOther(targetUserId)
    const username =
      payload.targetUsername ||
      friend?.username ||
      mr?.fromUsername ||
      mr?.toUsername ||
      targetUserId

    db.blockUser(targetUserId, username)
    if (friend) db.removeFriend(targetUserId)
    db.removeFriendRequestsBetween(selfUserId, targetUserId)
    if (mr) db.removeMessageRequest(mr.id)
    db.deleteMessageRequestThread(targetUserId)
    db.deleteConversationWith(targetUserId)
    return { success: true }
  })

  ipcMain.handle('block:unblock', (_e, payload: { targetUserId: string }) => {
    db.unblockUser(payload.targetUserId)
    return { success: true }
  })

  ipcMain.handle('block:list', () => db.getBlockedUsers())

  ipcMain.handle('block:is-blocked', (_e, payload: { userId: string }) => {
    return db.findBlocked(payload.userId) !== null
  })
}

/**
 * Register presence / discovery IPC handlers (Task 4).
 */
export function registerPresenceHandlers(): void {
  ipcMain.handle('presence:update', (_e, payload: { username: string; avatarColor: string | null; hidden: boolean }) => {
    socketClient.emitSignaling('presence:update', payload)
    return { success: true }
  })

  ipcMain.handle('presence:list', async () => {
    return new Promise<Array<{ userId: string; username: string; avatarColor: string | null }>>((resolve) => {
      const timeout = setTimeout(() => resolve([]), 3000)
      socketClient.emitSignalingWithAck(
        'presence:list',
        undefined,
        (list: Array<{ userId: string; username: string; avatarColor: string | null }>) => {
          clearTimeout(timeout)
          resolve(list || [])
        }
      )
    })
  })
}

// ── File Transfer ──

export function registerFileHandlers(): void {
  ipcMain.handle('file:pick', async () => {
    return fileManager.pickFile()
  })

  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const result = fileManager.readFileForSend(filePath)
    if (!result) return null
    return {
      base64: result.buffer.toString('base64'),
      fileName: result.fileName,
      fileSize: result.fileSize,
      fileType: result.fileType
    }
  })

  ipcMain.handle('file:save-received', async (_e, payload: {
    fileId: string
    fileName: string
    base64: string
  }) => {
    const buffer = Buffer.from(payload.base64, 'base64')
    const filePath = fileManager.saveReceivedFile(payload.fileId, payload.fileName, buffer)
    return { filePath }
  })

  ipcMain.handle('file:read-base64', async (_e, filePath: string) => {
    return fileManager.readFileAsBase64(filePath)
  })

  ipcMain.handle('file:exists', async (_e, filePath: string) => {
    return fileManager.fileExists(filePath)
  })

  ipcMain.handle('file:open', async (_e, filePath: string) => {
    shell.openPath(filePath)
    return { success: true }
  })

  ipcMain.handle('file:open-folder', async (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })

  ipcMain.handle('file:update-message-path', async (_e, payload: { messageId: string; filePath: string; isServer?: boolean }) => {
    if (payload.isServer) {
      db.updateServerMessageFilePath(payload.messageId, payload.filePath)
    } else {
      db.updateMessageFilePath(payload.messageId, payload.filePath)
    }
    return { success: true }
  })

  ipcMain.handle('file:max-size', () => {
    return fileManager.getMaxFileSize()
  })
}

// ── Desktop Capturer (screen-share picker sources) ──

export function registerDesktopHandlers(): void {
  ipcMain.handle('desktop:getSources', async (
    _e,
    opts: {
      types?: Array<'window' | 'screen'>
      thumbnailWidth?: number
      thumbnailHeight?: number
    } = {}
  ) => {
    const thumbnailWidth = opts.thumbnailWidth ?? 320
    const thumbnailHeight = opts.thumbnailHeight ?? 180
    const sources = await desktopCapturer.getSources({
      types: opts.types ?? ['window', 'screen'],
      thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
      fetchWindowIcons: true
    })
    // NativeImage isn't serializable across the IPC boundary — convert to data URLs.
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
      thumbnail: s.thumbnail?.toDataURL() ?? null,
      appIcon: s.appIcon?.toDataURL() ?? null
    }))
  })
}
