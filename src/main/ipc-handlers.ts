import { ipcMain, BrowserWindow, shell, desktopCapturer } from 'electron'
import * as identity from './identity'
import * as db from './database'
import * as socketClient from './socket-client'
import * as relayManager from './relay-manager'
import * as avatar from './avatar'
import * as serverAvatar from './server-avatar'
import * as fileManager from './file-manager'
import { showNotification, type NotifyPayload } from './notifications'
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
  ipcMain.handle('db:relays:add', (_e, relay: RelayRow) => db.addRelay(relay))
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
    if (req.direction !== 'incoming') return { success: false, error: 'Not an incoming request.' }

    // Promote to friend + create conversation locally
    db.addFriend({
      userId: req.fromUserId,
      username: req.fromUsername,
      avatarColor: req.fromAvatarColor,
      status: 'offline',
      lastSeen: null
    })
    db.upsertConversation({
      id: `dm_${req.fromUserId}`,
      recipientId: req.fromUserId,
      recipientName: req.fromUsername,
      recipientAvatarColor: req.fromAvatarColor,
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
    return { success: true, friend: { userId: req.fromUserId, username: req.fromUsername, avatarColor: req.fromAvatarColor } }
  })

  // Reject an incoming request. Payload: { requestId, selfUserId }
  ipcMain.handle('friend-request:reject', async (_e, payload: { requestId: string; selfUserId: string }) => {
    const all = db.getFriendRequests()
    const req = all.find((r) => r.id === payload.requestId)
    if (!req) return { success: false, error: 'Request not found.' }
    db.removeFriendRequest(req.id)
    // Task 1 spec says: "No notification to sender". So we do NOT emit.
    // But we still silently notify to clear their outgoing UI; spec says no notification.
    // Leave it silent — sender will learn only if they check. Keeping per spec.
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
    // Drop if already friends
    if (db.findFriend(payload.fromUserId)) return { success: false, error: 'already-friend' }

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
        socketClient.emitSignaling('friend-request:accept', {
          requestId: existing.id,
          fromUserId: payload.toUserId,
          fromUsername: '',
          fromAvatarColor: null,
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
      isMuted: 0
    })
    // Seed default category/channel pair so the new server has the same
    // shape as migrated legacy servers.
    db.seedDefaultServerChannelsIfMissing()

    socketClient.emitSignaling('server:register', {
      serverId,
      name: payload.name,
      iconColor: payload.iconColor,
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
      passwordHash: payload.passwordHash
    })

    return { success: true, serverId }
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
    // Local check if we have the server
    const srv = db.getServer(payload.serverId)
    if (srv && srv.passwordHash && srv.passwordHash !== payload.passwordHash) {
      return { success: false, error: 'Incorrect password.' }
    }
    if (!socketClient.isConnected()) {
      return { success: false, error: 'Not connected to signaling server. Check your network settings.' }
    }
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
    }
    members: Array<{ userId: string; username: string; avatarColor: string | null; role: string; isMuted: boolean }>
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
        passwordHash: null
      })
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
          isMuted: m.isMuted ? 1 : 0
        })
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

  // Send a text message in a server.
  ipcMain.handle('server:send-message', async (_e, payload: {
    serverId: string
    senderId: string
    senderName: string
    content: string
    channelId?: string | null
  }) => {
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
      channelId: payload.channelId ?? null
    })
    socketClient.emitSignaling('server:message', {
      serverId: payload.serverId,
      message: {
        id,
        senderId: payload.senderId,
        senderName: payload.senderName,
        content: payload.content,
        timestamp,
        channelId: payload.channelId ?? null
      }
    })
    return { success: true, messageId: id }
  })

  // Called by renderer when server:message event arrives — persist inbound.
  ipcMain.handle('server:message-remote', async (_e, payload: {
    serverId: string
    message: { id: string; senderId: string; senderName: string; content: string; timestamp: number; channelId?: string | null }
  }) => {
    db.insertServerMessage({
      id: payload.message.id,
      serverId: payload.serverId,
      senderId: payload.message.senderId,
      senderName: payload.message.senderName,
      content: payload.message.content,
      timestamp: payload.message.timestamp,
      status: 'delivered',
      channelId: payload.message.channelId ?? null
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
      isMuted: payload.member.isMuted ? 1 : 0
    })
    return { success: true }
  })

  // We (self) got kicked/banned → delete local server state.
  ipcMain.handle('server:remove-local', async (_e, payload: { serverId: string }) => {
    db.removeServer(payload.serverId)
    return { success: true }
  })

  // Re-register my hosted servers on signaling (e.g. after reconnect).
  ipcMain.handle('server:reregister-mine', async (_e, payload: { selfUserId: string }) => {
    const all = db.getServers().filter((s) => s.hostUserId === payload.selfUserId)
    for (const s of all) {
      const members = db.getServerMembers(s.id).map((m) => ({
        userId: m.userId,
        username: m.username,
        avatarColor: m.avatarColor,
        role: m.role,
        isMuted: m.isMuted === 1
      }))
      socketClient.emitSignaling('server:register', {
        serverId: s.id,
        name: s.name,
        iconColor: s.iconColor,
        textChannelName: s.textChannelName,
        voiceRoomName: s.voiceRoomName,
        hostUserId: s.hostUserId,
        hostUsername: s.hostUsername,
        hostAvatarColor: s.hostAvatarColor,
        members,
        banned: JSON.parse(s.banned || '[]')
      })
    }
    // Rejoin rooms of servers where I'm a member.
    const mine = db.getServers().filter((s) => s.hostUserId !== payload.selfUserId)
    for (const s of mine) {
      socketClient.emitSignaling('server:join', {
        serverId: s.id,
        userId: payload.selfUserId,
        username: '', // signaling will use stored member info
        avatarColor: null
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

  function canManageServer(serverId: string, actorId: string): boolean {
    const members = db.getServerMembers(serverId)
    const me = members.find((m) => m.userId === actorId)
    return !!me && (me.role === 'host' || me.role === 'moderator')
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
      position
    })
    return { success: true, channelId: id }
  })

  ipcMain.handle('server:rename-channel', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
    name: string
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    db.updateServerChannelName(payload.channelId, payload.name)
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
    return { success: true }
  })

  ipcMain.handle('server:delete-channel', async (_e, payload: {
    serverId: string
    actorId: string
    channelId: string
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    db.deleteServerChannel(payload.channelId)
    return { success: true }
  })

  ipcMain.handle('server:delete-category', async (_e, payload: {
    serverId: string
    actorId: string
    categoryId: string
  }) => {
    if (!canManageServer(payload.serverId, payload.actorId)) return { success: false, error: 'forbidden' }
    db.deleteServerCategory(payload.categoryId)
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
  ipcMain.handle('relay:start', async (_e, args: { port?: number; scope?: 'isp-local' | 'global' }) => {
    return relayManager.startRelay(args || {})
  })

  ipcMain.handle('relay:stop', () => relayManager.stopRelay())

  ipcMain.handle('relay:status', () => relayManager.getRelayStatus())

  ipcMain.handle('relay:register', async (_e, args: { signalingUrl: string; address: string; scope: 'isp-local' | 'global' }) => {
    return relayManager.registerWithSignaling(args.signalingUrl, args.address, args.scope)
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
