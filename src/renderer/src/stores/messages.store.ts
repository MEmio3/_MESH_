import { create } from 'zustand'
import type { Conversation, Message, FileAttachment } from '@/types/messages'
import { useIdentityStore } from './identity.store'
import { webrtcManager } from '@/lib/webrtc'
import { notify } from '@/lib/notify'
import { playDmReceived } from '@/lib/sounds'

/**
 * The `reactions` column is persisted as a JSON string in SQLite. When rows
 * come back through the IPC boundary untouched, that string leaks into the
 * Message shape and `Object.entries(...)` on it yields character-index pairs
 * like `["0","{"], ["1","}"]` — which rendered as fake "0"/"1" reaction chips
 * after every restart. Normalise at the boundary so the store only ever
 * holds a real `Record<string, string[]>`.
 */
export function normalizeReactions(raw: unknown): Record<string, string[]> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string[]>)
        : {}
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, string[]>
  }
  return {}
}

interface MessagesStore {
  conversations: Conversation[]
  activeConversationId: string | null

  initialize: () => Promise<void>
  loadMessages: (conversationId: string) => Promise<void>
  ensureConversationForFriend: (friendUserId: string) => Promise<Conversation | null>
  setActiveConversation: (id: string | null) => void
  sendMessage: (conversationId: string, content: string, replyTo?: { messageId: string; senderName: string; content: string }) => void
  sendFileMessage: (conversationId: string, filePath: string) => Promise<void>
  receiveMessage: (fromUserId: string, fromUsername: string, content: string) => void
  receiveFileMessage: (fromUserId: string, fromUsername: string, file: FileAttachment, messagePayload: { id: string; conversationId: string; content: string; timestamp: number }) => void
  markAsRead: (conversationId: string) => void
  getConversation: (id: string) => Conversation | undefined
  updateMessageStatus: (messageId: string, status: Message['status']) => void
  updateFileProgress: (messageId: string, progress: number) => void
  editMessage: (conversationId: string, messageId: string, newContent: string) => void
  deleteMessage: (conversationId: string, messageId: string) => void
  applyRemoteEdit: (messageId: string, content: string, editedAt: number) => void
  applyRemoteDelete: (messageId: string) => void
  handleAck: (fromUserId: string, messageId: string, status: 'delivered' | 'read') => void
  toggleReaction: (conversationId: string, messageId: string, emojiId: string) => Promise<void>
  applyRemoteReaction: (messageId: string, emojiId: string, userId: string, add: boolean) => void
  // Full-replace variant: overwrites the entire reactions map for a message
  // with the authoritative snapshot from the remote side. Used by the new
  // reaction-sync payload that ships the whole reactions object, not a delta.
  applyRemoteReactionFull: (messageId: string, reactions: Record<string, string[]>) => void
}

/**
 * Send a control payload (delivery/read ack) to a peer.
 * Prefers the P2P data channel, falls back to signaling relay.
 */
function sendControlToPeer(recipientId: string, payload: object): void {
  const json = JSON.stringify(payload)
  const ok = webrtcManager.sendDataMessage(recipientId, json)
  if (!ok) {
    try { window.api.signaling.emit('dm-message', recipientId, json) } catch { /* ignore */ }
  }
}

export const useMessagesStore = create<MessagesStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,

  initialize: async () => {
    const rows = await window.api.db.conversations.list()
    // Deduplicate on load: if the DB contains multiple rows for the same
    // recipientId (legacy bug before the id normalisation), keep the one
    // whose id matches dm_<recipientId> when possible, otherwise the first
    // one seen, and delete the others from the DB so they don't come back
    // next session.
    const byRecipient = new Map<string, typeof rows[number]>()
    for (const r of rows) {
      const existing = byRecipient.get(r.recipientId)
      if (!existing) {
        byRecipient.set(r.recipientId, r)
        continue
      }
      const canonicalId = `dm_${r.recipientId}`
      const keep = existing.id === canonicalId ? existing
        : r.id === canonicalId ? r
        : existing
      const drop = keep === existing ? r : existing
      byRecipient.set(r.recipientId, keep)
      // In-memory dedupe is authoritative for this session. If a future IPC
      // exposes a remove method we can also prune the DB row; for now the
      // duplicate simply won't appear in the sidebar.
      void drop
    }
    const conversations: Conversation[] = Array.from(byRecipient.values()).map((r) => ({
      id: r.id,
      recipientId: r.recipientId,
      recipientName: r.recipientName,
      recipientAvatarColor: r.recipientAvatarColor,
      recipientStatus: r.recipientStatus as Conversation['recipientStatus'],
      messages: [],
      unreadCount: r.unreadCount,
      lastMessage: null
    }))

    // Load recent messages for each conversation to populate lastMessage
    for (const conv of conversations) {
      const msgs = await window.api.db.messages.list({ conversationId: conv.id, limit: 50 })
      conv.messages = msgs.reverse().map((r) => {
        const msg = r as Message & { fileId?: string | null; fileName?: string | null; fileSize?: number | null; fileType?: string | null; filePath?: string | null }
        if (msg.fileId) {
          msg.file = {
            fileId: msg.fileId,
            fileName: msg.fileName || 'unknown',
            fileSize: msg.fileSize || 0,
            fileType: msg.fileType || 'application/octet-stream',
            filePath: msg.filePath
          }
        }
        msg.reactions = normalizeReactions(msg.reactions)
        return msg as Message
      })
      conv.lastMessage = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null
    }

    set({ conversations })
  },

  loadMessages: async (conversationId) => {
    const msgs = await window.api.db.messages.list({ conversationId, limit: 50 })
    const messages = msgs.reverse().map((r) => {
      const msg = r as Message & { fileId?: string | null; fileName?: string | null; fileSize?: number | null; fileType?: string | null; filePath?: string | null }
      if (msg.fileId) {
        msg.file = {
          fileId: msg.fileId,
          fileName: msg.fileName || 'unknown',
          fileSize: msg.fileSize || 0,
          fileType: msg.fileType || 'application/octet-stream',
          filePath: msg.filePath
        }
      }
      msg.reactions = normalizeReactions(msg.reactions)
      return msg as Message
    })
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? { ...conv, messages, lastMessage: messages.length > 0 ? messages[messages.length - 1] : null }
          : conv
      )
    }))
  },

  /**
   * Get the conversation for a friend, creating an empty one if it doesn't exist.
   * Supports the flow where clicking a friend in Online/All tab opens their DM
   * even before any messages have been exchanged.
   */
  ensureConversationForFriend: async (friendUserId) => {
    const conversationId = friendUserId.startsWith('dm_') ? friendUserId : `dm_${friendUserId}`
    const recipientId = conversationId.startsWith('dm_') ? conversationId.slice(3) : friendUserId

    // Match on recipientId too so a legacy conversation under a different
    // id (e.g. from the old payload-trusting routing bug) is reused instead
    // of cloned into a sidebar duplicate.
    const existing = get().conversations.find(
      (c) => c.id === conversationId || c.recipientId === recipientId
    )
    if (existing) return existing

    const friends = (await window.api.db.friends.list()) as Array<{
      userId: string
      username: string
      avatarColor: string | null
      status: string
    }>
    const friend = friends.find((f) => f.userId === recipientId)
    if (!friend) return null

    const row = {
      id: conversationId,
      recipientId: friend.userId,
      recipientName: friend.username,
      recipientAvatarColor: friend.avatarColor,
      recipientStatus: friend.status,
      unreadCount: 0
    }
    await window.api.db.conversations.upsert(row)

    const conv: Conversation = {
      id: row.id,
      recipientId: row.recipientId,
      recipientName: row.recipientName,
      recipientAvatarColor: row.recipientAvatarColor,
      recipientStatus: row.recipientStatus as Conversation['recipientStatus'],
      messages: [],
      unreadCount: 0,
      lastMessage: null
    }
    set((state) => ({ conversations: [...state.conversations, conv] }))
    return conv
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  sendMessage: (conversationId, content, replyTo?) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return

    const msg: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      senderId: identity.userId,
      senderName: identity.username,
      content,
      timestamp: Date.now(),
      status: 'sending',
      replyTo: replyTo ?? null
    }

    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? { ...conv, messages: [...conv.messages, msg], lastMessage: msg }
          : conv
      )
    }))

    // Persist to DB
    window.api.db.messages.send({
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      timestamp: msg.timestamp,
      status: msg.status
    })

    // Try P2P delivery via WebRTC data channel; fall back to signaling relay.
    const conv = get().conversations.find((c) => c.id === conversationId)
    if (conv) {
      const payload = JSON.stringify({
        type: 'dm',
        id: msg.id,
        conversationId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content,
        timestamp: msg.timestamp,
        replyTo: replyTo ?? null
      })
      const p2pDelivered = webrtcManager.sendDataMessage(conv.recipientId, payload)
      if (!p2pDelivered) {
        // Fallback: relay through signaling server
        window.api.signaling.emit('dm-message', conv.recipientId, payload)
      }
      // Optimistic: the message has left this device. Upgrade to 'delivered'
      // only when the recipient acks, and 'read' when they open the thread.
      get().updateMessageStatus(msg.id, 'sent')
    }
  },

  sendFileMessage: async (conversationId, filePath) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return

    const fileData = await window.api.file.read(filePath)
    if (!fileData) return

    const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const file: FileAttachment = {
      fileId,
      fileName: fileData.fileName,
      fileSize: fileData.fileSize,
      fileType: fileData.fileType,
      filePath, // local path for sender
      base64: fileData.fileType.startsWith('image/') ? fileData.base64 : undefined
    }

    const msg: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      senderId: identity.userId,
      senderName: identity.username,
      content: `[File: ${fileData.fileName}]`,
      timestamp: Date.now(),
      status: 'sending',
      file
    }

    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? { ...conv, messages: [...conv.messages, msg], lastMessage: msg }
          : conv
      )
    }))

    // Persist to DB with file metadata
    window.api.db.messages.send({
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      timestamp: msg.timestamp,
      status: msg.status,
      fileId: file.fileId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      fileType: file.fileType,
      filePath: file.filePath || null
    } as import('../../shared/types').MessageRow)

    // Send via WebRTC data channel
    const conv = get().conversations.find((c) => c.id === conversationId)
    if (conv) {
      // Send metadata message first (JSON text)
      const metaPayload = JSON.stringify({
        type: 'dm-file',
        id: msg.id,
        conversationId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        timestamp: msg.timestamp,
        file: {
          fileId: file.fileId,
          fileName: file.fileName,
          fileSize: file.fileSize,
          fileType: file.fileType
        }
      })

      const p2p = webrtcManager.hasDataChannel(conv.recipientId)
      if (p2p) {
        webrtcManager.sendDataMessage(conv.recipientId, metaPayload)
        // Then send binary file data
        await webrtcManager.sendFile(
          conv.recipientId,
          file.fileId,
          file.fileName,
          file.fileSize,
          file.fileType,
          fileData.base64
        )
        get().updateMessageStatus(msg.id, 'sent')
      } else {
        // Fallback: send file as base64 in JSON via signaling (for smaller files)
        if (fileData.fileSize <= 2 * 1024 * 1024) {
          const fallbackPayload = JSON.stringify({
            type: 'dm-file',
            id: msg.id,
            conversationId,
            senderId: msg.senderId,
            senderName: msg.senderName,
            timestamp: msg.timestamp,
            file: {
              fileId: file.fileId,
              fileName: file.fileName,
              fileSize: file.fileSize,
              fileType: file.fileType,
              base64: fileData.base64
            }
          })
          window.api.signaling.emit('dm-message', conv.recipientId, fallbackPayload)
          get().updateMessageStatus(msg.id, 'sent')
        } else {
          // Too large for signaling relay — need P2P
          console.warn('[file] File too large for signaling relay, need P2P connection')
        }
      }
    }
  },

  receiveFileMessage: (fromUserId, fromUsername, file, messagePayload) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return

    // Same rule as receiveMessage: the conversation id is authoritatively
    // derived from the sender's userId on our side. Never trust the remote
    // payload's conversationId — it reflects THEIR local mapping, not ours.
    const conversationId = `dm_${fromUserId}`
    const msg: Message = {
      id: messagePayload.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      senderId: fromUserId,
      senderName: fromUsername,
      content: messagePayload.content || `[File: ${file.fileName}]`,
      timestamp: messagePayload.timestamp || Date.now(),
      status: 'delivered',
      file
    }

    const existing = get().conversations.find(
      (c) => c.recipientId === fromUserId || c.id === conversationId
    )
    const targetConvId = existing?.id ?? conversationId
    msg.conversationId = targetConvId
    if (!existing) {
      window.api.db.conversations.upsert({
        id: targetConvId,
        recipientId: fromUserId,
        recipientName: fromUsername,
        recipientAvatarColor: null,
        recipientStatus: 'online',
        unreadCount: 1
      })
      set((state) => ({
        conversations: [
          ...state.conversations,
          {
            id: targetConvId,
            recipientId: fromUserId,
            recipientName: fromUsername,
            recipientAvatarColor: null,
            recipientStatus: 'online',
            messages: [msg],
            unreadCount: 1,
            lastMessage: msg
          }
        ]
      }))
    } else {
      const isActive = get().activeConversationId === targetConvId
      set((state) => ({
        conversations: state.conversations.map((conv) =>
          conv.id === targetConvId
            ? {
                ...conv,
                messages: [...conv.messages, msg],
                lastMessage: msg,
                unreadCount: isActive ? 0 : conv.unreadCount + 1
              }
            : conv
        )
      }))
    }

    // Persist with file info
    window.api.db.messages.send({
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      timestamp: msg.timestamp,
      status: msg.status,
      fileId: file.fileId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      fileType: file.fileType,
      filePath: file.filePath || null
    } as import('../../shared/types').MessageRow)

    // Ack delivery
    sendControlToPeer(fromUserId, { type: 'dm-ack', messageId: msg.id, status: 'delivered' })

    // Audible chime — only when the message isn't from ourselves (can't happen
    // on the receive path, but guard anyway for future bulk imports).
    const selfId = useIdentityStore.getState().identity?.userId
    if (fromUserId !== selfId) playDmReceived()

    notify({
      type: 'dm',
      title: fromUsername || 'New file',
      body: `Sent a file: ${file.fileName}`,
      route: `/channels/@me/${targetConvId}`
    })
  },

  updateFileProgress: (messageId, progress) => {
    set((state) => ({
      conversations: state.conversations.map((conv) => ({
        ...conv,
        messages: conv.messages.map((m) =>
          m.id === messageId && m.file
            ? { ...m, file: { ...m.file, transferProgress: progress } }
            : m
        )
      }))
    }))
  },

  /**
   * Handle an incoming message from a peer (via WebRTC data channel or signaling fallback).
   * Stores to DB and appends to the conversation.
   */
  receiveMessage: (fromUserId, fromUsername, content) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return

    let parsed: { id?: string; conversationId?: string; content?: string; timestamp?: number; replyTo?: { messageId: string; senderName: string; content: string } | null } = {}
    try {
      parsed = JSON.parse(content)
    } catch {
      // Plain string payload
    }

    // CRITICAL: always derive the conversation id from the sender's userId.
    // The remote `parsed.conversationId` is the SENDER's local id for THEIR
    // conversation with us (dm_<ourId> on their device) — trusting it has
    // caused messages to land in the wrong conversation on the receiver
    // (e.g. a message from Tester appearing in the proyas DM on MEmio3's
    // screen because the payload carried a mismatched id). The only correct
    // key for OUR conversation with the sender is dm_<sender's userId>.
    const conversationId = `dm_${fromUserId}`
    const msg: Message = {
      id: parsed.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      senderId: fromUserId,
      senderName: fromUsername,
      content: parsed.content || content,
      timestamp: parsed.timestamp || Date.now(),
      status: 'delivered',
      replyTo: parsed.replyTo ?? null
    }

    // Look up the conversation by the SENDER's userId (recipientId) rather
    // than just id, so legacy conversations created with a different id
    // scheme still match and we never create a duplicate for the same peer.
    const existing = get().conversations.find(
      (c) => c.recipientId === fromUserId || c.id === conversationId
    )
    // If an existing conversation is found via recipientId but has a legacy
    // id different from dm_<fromUserId>, keep storing into the existing one
    // so messages stay consolidated and no sidebar duplicate appears.
    const targetConvId = existing?.id ?? conversationId
    msg.conversationId = targetConvId
    if (!existing) {
      window.api.db.conversations.upsert({
        id: targetConvId,
        recipientId: fromUserId,
        recipientName: fromUsername,
        recipientAvatarColor: null,
        recipientStatus: 'online',
        unreadCount: 1
      })
      set((state) => ({
        conversations: [
          ...state.conversations,
          {
            id: targetConvId,
            recipientId: fromUserId,
            recipientName: fromUsername,
            recipientAvatarColor: null,
            recipientStatus: 'online',
            messages: [msg],
            unreadCount: 1,
            lastMessage: msg
          }
        ]
      }))
    } else {
      const isActive = get().activeConversationId === targetConvId
      set((state) => ({
        conversations: state.conversations.map((conv) =>
          conv.id === targetConvId
            ? {
                ...conv,
                messages: [...conv.messages, msg],
                lastMessage: msg,
                unreadCount: isActive ? 0 : conv.unreadCount + 1
              }
            : conv
        )
      }))
    }

    // Persist
    window.api.db.messages.send({
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      timestamp: msg.timestamp,
      status: msg.status
    })

    // Task 9: ack delivery back to the sender.
    sendControlToPeer(fromUserId, {
      type: 'dm-ack',
      messageId: msg.id,
      status: 'read' === msg.status ? 'read' : 'delivered'
    })
    // If the recipient already has this conversation open, mark as read too.
    if (get().activeConversationId === targetConvId) {
      sendControlToPeer(fromUserId, { type: 'dm-ack', messageId: msg.id, status: 'read' })
    }

    // Audible chime for an incoming DM that isn't from ourselves.
    const selfId = useIdentityStore.getState().identity?.userId
    if (fromUserId !== selfId) playDmReceived()

    // Desktop notification — skipped if window is focused on this conversation.
    notify({
      type: 'dm',
      title: fromUsername || 'New message',
      body: String(msg.content).slice(0, 140),
      route: `/channels/@me/${targetConvId}`
    })
  },

  markAsRead: (conversationId) => {
    const conv = get().conversations.find((c) => c.id === conversationId)
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      )
    }))
    window.api.db.conversations.updateUnread(conversationId, 0)

    // Task 9: send "read" receipt for unread messages from the other party.
    if (conv) {
      const selfId = useIdentityStore.getState().identity?.userId
      const toAck = conv.messages.filter(
        (m) => m.senderId !== selfId && m.status !== 'read'
      )
      for (const m of toAck) {
        sendControlToPeer(conv.recipientId, {
          type: 'dm-ack',
          messageId: m.id,
          status: 'read'
        })
      }
    }
  },

  getConversation: (id) => get().conversations.find((c) => c.id === id),

  updateMessageStatus: (messageId, status) => {
    set((state) => ({
      conversations: state.conversations.map((conv) => {
        const idx = conv.messages.findIndex((m) => m.id === messageId)
        if (idx === -1) return conv
        const messages = conv.messages.slice()
        // Status only ever progresses: sending → sent → delivered → read.
        const rank: Record<Message['status'], number> = { sending: 0, sent: 1, delivered: 2, read: 3 }
        if (rank[status] <= rank[messages[idx].status]) return conv
        messages[idx] = { ...messages[idx], status }
        const lastMessage = conv.lastMessage && conv.lastMessage.id === messageId
          ? messages[idx]
          : conv.lastMessage
        return { ...conv, messages, lastMessage }
      })
    }))
    window.api.db.messages.updateStatus(messageId, status)
  },

  editMessage: (conversationId, messageId, newContent) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return

    const editedAt = Date.now()
    // Update in-memory
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === messageId ? { ...m, content: newContent, editedAt } : m
              )
            }
          : conv
      )
    }))

    // Persist to DB
    window.api.db.messages.edit(messageId, newContent, editedAt)

    // Notify the other party via P2P or signaling
    const conv = get().conversations.find((c) => c.id === conversationId)
    if (conv) {
      const payload = { messageId, content: newContent, editedAt }
      const json = JSON.stringify({ type: 'dm-edit', ...payload })
      const ok = webrtcManager.sendDataMessage(conv.recipientId, json)
      if (!ok) {
        window.api.signaling.emit('dm-edit', conv.recipientId, payload)
      }
    }
  },

  deleteMessage: (conversationId, messageId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return

    // Update in-memory
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === messageId ? { ...m, content: '', isDeleted: true, file: null } : m
              )
            }
          : conv
      )
    }))

    // Persist to DB
    window.api.db.messages.delete(messageId)

    // Notify the other party
    const conv = get().conversations.find((c) => c.id === conversationId)
    if (conv) {
      const payload = { messageId }
      const json = JSON.stringify({ type: 'dm-delete', ...payload })
      const ok = webrtcManager.sendDataMessage(conv.recipientId, json)
      if (!ok) {
        window.api.signaling.emit('dm-delete', conv.recipientId, payload)
      }
    }
  },

  applyRemoteEdit: (messageId, content, editedAt) => {
    set((state) => ({
      conversations: state.conversations.map((conv) => ({
        ...conv,
        messages: conv.messages.map((m) =>
          m.id === messageId ? { ...m, content, editedAt } : m
        )
      }))
    }))
    window.api.db.messages.edit(messageId, content, editedAt)
  },

  applyRemoteDelete: (messageId) => {
    set((state) => ({
      conversations: state.conversations.map((conv) => ({
        ...conv,
        messages: conv.messages.map((m) =>
          m.id === messageId ? { ...m, content: '', isDeleted: true, file: null } : m
        )
      }))
    }))
    window.api.db.messages.delete(messageId)
  },

  handleAck: (_fromUserId, messageId, status) => {
    get().updateMessageStatus(messageId, status)
  },

  toggleReaction: async (conversationId, messageId, emojiId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return

    const { conversations } = get()
    const conv = conversations.find((c) => c.id === conversationId)
    if (!conv) return

    const msg = conv.messages.find((m) => m.id === messageId)
    if (!msg) return

    const myReacts = msg.reactions?.[emojiId] || []
    const selfId = identity.userId
    const alreadyReacted = myReacts.includes(selfId)
    const add = !alreadyReacted

    // Optimistically update local state
    get().applyRemoteReaction(messageId, emojiId, selfId, add)

    // Re-read the freshly updated message to get the FULL reactions snapshot.
    // We ship the whole map (not just the emojiId/add delta) so concurrent
    // reactions on the remote side can't interleave into a divergent state —
    // receiver replaces its local map entirely with this authoritative copy.
    const updatedMsg = get().conversations.find((c) => c.id === conversationId)
      ?.messages.find((m) => m.id === messageId)
    const reactions = updatedMsg?.reactions ? { ...updatedMsg.reactions } : {}

    // Payload carries both the delta (emojiId/add/userId — kept for DB
    // persistence on the other side) AND the full reactions map for
    // authoritative state replacement.
    const payload = { messageId, emojiId, userId: selfId, add, reactions }
    const json = JSON.stringify({ type: 'dm-reaction', ...payload })
    const ok = webrtcManager.sendDataMessage(conv.recipientId, json)
    if (!ok) {
      window.api.signaling.emit('dm-reaction', conv.recipientId, payload)
    }

    // Call API (this handles local DB persistence)
    await window.api.reaction.toggleDm({
      conversationId,
      messageId,
      emojiId,
      userId: selfId,
      otherUserId: conv.recipientId,
      add
    })
  },

  applyRemoteReactionFull: (messageId, reactions) => {
    set((state) => ({
      conversations: state.conversations.map((conv) => {
        const hasMsg = conv.messages.some((m) => m.id === messageId)
        if (!hasMsg) return conv
        return {
          ...conv,
          messages: conv.messages.map((m) => {
            if (m.id !== messageId) return m
            // Replace — do not merge. The remote map is authoritative so
            // concurrent local/remote toggles resolve to the latest snapshot.
            return { ...m, reactions: { ...reactions } }
          })
        }
      })
    }))
  },

  applyRemoteReaction: (messageId, emojiId, userId, add) => {
    set((state) => ({
      conversations: state.conversations.map((conv) => {
        const hasMsg = conv.messages.some((m) => m.id === messageId)
        if (!hasMsg) return conv
        return {
          ...conv,
          messages: conv.messages.map((m) => {
            if (m.id !== messageId) return m
            const existingMap = m.reactions || {}
            const existingList = existingMap[emojiId] || []
            let newList = [...existingList]
            if (add && !newList.includes(userId)) {
              newList.push(userId)
            } else if (!add && newList.includes(userId)) {
              newList = newList.filter((id) => id !== userId)
            }
            const newMap = { ...existingMap, [emojiId]: newList }
            if (newMap[emojiId].length === 0) {
              delete newMap[emojiId]
            }
            return { ...m, reactions: newMap }
          })
        }
      })
    }))
  }
}))

/**
 * Route an incoming payload (from WebRTC data channel OR signaling relay)
 * through the right store handler. Exported so App.tsx can subscribe the
 * signaling fallback path to it.
 */
export function handleIncomingPeerMessage(userId: string, message: string): void {
  try {
    const parsed = JSON.parse(message)
    if (parsed.type === 'avatar-sync' && typeof parsed.base64 === 'string') {
      import('./avatar.store').then((m) => m.useAvatarStore.getState().handleIncoming(userId, parsed.base64))
      return
    }
    if (parsed.type === 'typing:start') {
      import('@/pages/dm/DmConversationPage').then((m) => m.emitTypingEvent(userId, true))
      return
    }
    if (parsed.type === 'typing:stop') {
      import('@/pages/dm/DmConversationPage').then((m) => m.emitTypingEvent(userId, false))
      return
    }
    if (parsed.type === 'dm') {
      useMessagesStore.getState().receiveMessage(userId, parsed.senderName || 'Peer', message)
      return
    }
    if (parsed.type === 'dm-file') {
      // File message — may include base64 data (signaling fallback) or arrive separately via binary channel
      handleIncomingFileMessage(userId, parsed)
      return
    }
    if (parsed.type === 'dm-ack' && typeof parsed.messageId === 'string') {
      const status = parsed.status === 'read' ? 'read' : 'delivered'
      useMessagesStore.getState().handleAck(userId, parsed.messageId, status)
      return
    }
    if (parsed.type === 'dm-edit' && typeof parsed.messageId === 'string') {
      useMessagesStore.getState().applyRemoteEdit(parsed.messageId, parsed.content, parsed.editedAt)
      return
    }
    if (parsed.type === 'dm-delete' && typeof parsed.messageId === 'string') {
      useMessagesStore.getState().applyRemoteDelete(parsed.messageId)
      return
    }
    if (parsed.type === 'dm-reaction' && typeof parsed.messageId === 'string') {
      // Prefer the full reactions map when present (new payload format).
      // Falls back to the delta merge for backward compat with older peers.
      if (parsed.reactions && typeof parsed.reactions === 'object') {
        useMessagesStore.getState().applyRemoteReactionFull(
          parsed.messageId, parsed.reactions
        )
      } else {
        useMessagesStore.getState().applyRemoteReaction(
          parsed.messageId, parsed.emojiId, parsed.userId, parsed.add
        )
      }
      // Persist the delta locally so the DB reflects this reaction (the full
      // map is in-memory only; DB schema still tracks per-emoji toggles).
      if (typeof parsed.emojiId === 'string' && typeof parsed.userId === 'string' && typeof parsed.add === 'boolean') {
        window.api.reaction.applyDm({
          messageId: parsed.messageId,
          emojiId: parsed.emojiId,
          userId: parsed.userId,
          add: parsed.add
        }).catch(console.error)
      }
      return
    }
  } catch {
    useMessagesStore.getState().receiveMessage(userId, 'Peer', message)
  }
}

async function handleIncomingFileMessage(userId: string, parsed: {
  id: string; conversationId: string; senderId: string; senderName: string; timestamp: number
  file: { fileId: string; fileName: string; fileSize: number; fileType: string; base64?: string }
}): Promise<void> {
  const file = parsed.file
  let filePath: string | null = null
  let base64Preview: string | undefined

  // If base64 data is included (signaling fallback for small files), save immediately
  if (file.base64) {
    const result = await window.api.file.saveReceived({
      fileId: file.fileId,
      fileName: file.fileName,
      base64: file.base64
    })
    filePath = result.filePath
    if (file.fileType.startsWith('image/')) {
      base64Preview = file.base64
    }
  }

  useMessagesStore.getState().receiveFileMessage(
    userId,
    parsed.senderName || 'Peer',
    {
      fileId: file.fileId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      fileType: file.fileType,
      filePath,
      base64: base64Preview
    },
    {
      id: parsed.id,
      conversationId: parsed.conversationId,
      content: `[File: ${file.fileName}]`,
      timestamp: parsed.timestamp
    }
  )
}

// Wire WebRTC data-channel messages directly into the store.
webrtcManager.onDataMessage = (userId, message) => {
  handleIncomingPeerMessage(userId, message)
}

// Wire file transfer callbacks
webrtcManager.onFileReceived = async (userId, meta, data) => {
  // Convert ArrayBuffer to base64 and save
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)

  const result = await window.api.file.saveReceived({
    fileId: meta.fileId,
    fileName: meta.fileName,
    base64
  })

  // Find the pending file message and update its path
  const store = useMessagesStore.getState()
  for (const conv of store.conversations) {
    const msg = conv.messages.find((m) => m.file?.fileId === meta.fileId)
    if (msg) {
      // Update in-memory
      useMessagesStore.setState((state) => ({
        conversations: state.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === msg.id && m.file
              ? { ...m, file: { ...m.file, filePath: result.filePath, transferProgress: 100 } }
              : m
          )
        }))
      }))
      // Update in DB
      await window.api.file.updateMessagePath({ messageId: msg.id, filePath: result.filePath })
      break
    }
  }
}

webrtcManager.onFileProgress = (userId, fileId, progress) => {
  const store = useMessagesStore.getState()
  for (const conv of store.conversations) {
    const msg = conv.messages.find((m) => m.file?.fileId === fileId)
    if (msg) {
      store.updateFileProgress(msg.id, progress)
      break
    }
  }
}
