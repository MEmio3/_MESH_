import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => {
      callback(maximized)
    }
    ipcRenderer.on('window:maximized-change', handler)
    return () => {
      ipcRenderer.removeListener('window:maximized-change', handler)
    }
  },

  // Identity
  identityExists: (): Promise<boolean> => ipcRenderer.invoke('identity:exists'),
  identityGenerate: (args: { username: string; avatarColor: string | null }): Promise<{ userId: string; publicKey: string }> =>
    ipcRenderer.invoke('identity:generate', args),
  identityLoad: (): Promise<{
    userId: string
    publicKey: string
    username: string
    avatarColor: string | null
    createdAt: number
  } | null> => ipcRenderer.invoke('identity:load'),

  // Database
  db: {
    friends: {
      list: () => ipcRenderer.invoke('db:friends:list'),
      add: (friend: unknown) => ipcRenderer.invoke('db:friends:add', friend),
      remove: (userId: string) => ipcRenderer.invoke('db:friends:remove', userId),
      updateStatus: (userId: string, status: string) => ipcRenderer.invoke('db:friends:update-status', { userId, status })
    },
    friendRequests: {
      list: () => ipcRenderer.invoke('db:friend-requests:list'),
      add: (req: unknown) => ipcRenderer.invoke('db:friend-requests:add', req),
      remove: (id: string) => ipcRenderer.invoke('db:friend-requests:remove', id)
    },
    messageRequests: {
      list: () => ipcRenderer.invoke('db:message-requests:list'),
      add: (req: unknown) => ipcRenderer.invoke('db:message-requests:add', req),
      remove: (id: string) => ipcRenderer.invoke('db:message-requests:remove', id)
    },
    conversations: {
      list: () => ipcRenderer.invoke('db:conversations:list'),
      upsert: (conv: unknown) => ipcRenderer.invoke('db:conversations:upsert', conv),
      updateUnread: (id: string, unreadCount: number) => ipcRenderer.invoke('db:conversations:update-unread', { id, unreadCount })
    },
    messages: {
      list: (args: { conversationId: string; limit?: number; before?: number }) => ipcRenderer.invoke('db:messages:list', args),
      send: (msg: unknown) => ipcRenderer.invoke('db:messages:send', msg),
      updateStatus: (id: string, status: string) => ipcRenderer.invoke('db:messages:update-status', { id, status }),
      edit: (id: string, content: string, editedAt: number) => ipcRenderer.invoke('db:messages:edit', { id, content, editedAt }),
      delete: (id: string) => ipcRenderer.invoke('db:messages:delete', id),
      get: (id: string) => ipcRenderer.invoke('db:messages:get', id)
    },
    servers: {
      list: () => ipcRenderer.invoke('db:servers:list'),
      add: (server: unknown) => ipcRenderer.invoke('db:servers:add', server),
      remove: (serverId: string) => ipcRenderer.invoke('db:servers:remove', serverId)
    },
    serverMembers: {
      list: (serverId: string) => ipcRenderer.invoke('db:server-members:list', serverId),
      add: (member: unknown) => ipcRenderer.invoke('db:server-members:add', member)
    },
    serverMessages: {
      list: (args: { serverId: string; limit?: number; before?: number }) => ipcRenderer.invoke('db:server-messages:list', args),
      send: (msg: unknown) => ipcRenderer.invoke('db:server-messages:send', msg),
      edit: (id: string, content: string, editedAt: number) => ipcRenderer.invoke('db:server-messages:edit', { id, content, editedAt }),
      delete: (id: string) => ipcRenderer.invoke('db:server-messages:delete', id)
    },
    blocked: {
      list: () => ipcRenderer.invoke('db:blocked:list'),
      add: (userId: string, username: string) => ipcRenderer.invoke('db:blocked:add', { userId, username }),
      remove: (userId: string) => ipcRenderer.invoke('db:blocked:remove', userId)
    },
    relays: {
      list: () => ipcRenderer.invoke('db:relays:list'),
      add: (relay: unknown) => ipcRenderer.invoke('db:relays:add', relay),
      remove: (id: string) => ipcRenderer.invoke('db:relays:remove', id)
    },
    settings: {
      get: (key: string) => ipcRenderer.invoke('db:settings:get', key),
      set: (key: string, value: string) => ipcRenderer.invoke('db:settings:set', { key, value })
    }
  },

  // Signaling (socket.io client lives in main process)
  signaling: {
    connect: (serverUrl: string, userId: string): Promise<void> =>
      ipcRenderer.invoke('signaling:connect', { serverUrl, userId }),
    disconnect: (): Promise<void> => ipcRenderer.invoke('signaling:disconnect'),
    isConnected: (): Promise<boolean> => ipcRenderer.invoke('signaling:is-connected'),
    socketId: (): Promise<string | null> => ipcRenderer.invoke('signaling:socket-id'),
    emit: (event: string, ...args: unknown[]): void => ipcRenderer.send('signaling:emit', event, ...args),

    onConnected: (cb: () => void): (() => void) => {
      const h = (): void => cb()
      ipcRenderer.on('signaling:connected', h)
      return () => ipcRenderer.removeListener('signaling:connected', h)
    },
    onReconnectStatus: (cb: (payload: { state: 'reconnecting' | 'connected' | 'failed'; attempt?: number; max?: number }) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: { state: 'reconnecting' | 'connected' | 'failed'; attempt?: number; max?: number }): void => cb(payload)
      ipcRenderer.on('signaling:reconnect-status', h)
      return () => ipcRenderer.removeListener('signaling:reconnect-status', h)
    },
    onDisconnected: (cb: (reason: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, reason: string): void => cb(reason)
      ipcRenderer.on('signaling:disconnected', h)
      return () => ipcRenderer.removeListener('signaling:disconnected', h)
    },
    onError: (cb: (message: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, message: string): void => cb(message)
      ipcRenderer.on('signaling:error', h)
      return () => ipcRenderer.removeListener('signaling:error', h)
    },
    onUserJoined: (cb: (userId: string, socketId: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, userId: string, socketId: string): void => cb(userId, socketId)
      ipcRenderer.on('signaling:user-joined', h)
      return () => ipcRenderer.removeListener('signaling:user-joined', h)
    },
    onUserLeft: (cb: (userId: string, socketId: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, userId: string, socketId: string): void => cb(userId, socketId)
      ipcRenderer.on('signaling:user-left', h)
      return () => ipcRenderer.removeListener('signaling:user-left', h)
    },
    onOffer: (cb: (fromSocketId: string, offer: RTCSessionDescriptionInit, fromUserId: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromSocketId: string, offer: RTCSessionDescriptionInit, fromUserId: string): void =>
        cb(fromSocketId, offer, fromUserId)
      ipcRenderer.on('signaling:offer', h)
      return () => ipcRenderer.removeListener('signaling:offer', h)
    },
    onAnswer: (cb: (fromSocketId: string, answer: RTCSessionDescriptionInit) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromSocketId: string, answer: RTCSessionDescriptionInit): void =>
        cb(fromSocketId, answer)
      ipcRenderer.on('signaling:answer', h)
      return () => ipcRenderer.removeListener('signaling:answer', h)
    },
    onIceCandidate: (cb: (fromSocketId: string, candidate: RTCIceCandidateInit) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromSocketId: string, candidate: RTCIceCandidateInit): void =>
        cb(fromSocketId, candidate)
      ipcRenderer.on('signaling:ice-candidate', h)
      return () => ipcRenderer.removeListener('signaling:ice-candidate', h)
    },
    onDmMessage: (cb: (fromUserId: string, message: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromUserId: string, message: string): void => cb(fromUserId, message)
      ipcRenderer.on('signaling:dm-message', h)
      return () => ipcRenderer.removeListener('signaling:dm-message', h)
    },
    onDmEdit: (cb: (fromUserId: string, payload: { messageId: string; content: string; editedAt: number }) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromUserId: string, payload: { messageId: string; content: string; editedAt: number }): void => cb(fromUserId, payload)
      ipcRenderer.on('signaling:dm-edit', h)
      return () => ipcRenderer.removeListener('signaling:dm-edit', h)
    },
    onDmDelete: (cb: (fromUserId: string, payload: { messageId: string }) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromUserId: string, payload: { messageId: string }): void => cb(fromUserId, payload)
      ipcRenderer.on('signaling:dm-delete', h)
      return () => ipcRenderer.removeListener('signaling:dm-delete', h)
    },
    onDmReaction: (cb: (fromUserId: string, payload: { messageId: string; emojiId: string; add: boolean; userId: string }) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromUserId: string, payload: { messageId: string; emojiId: string; add: boolean; userId: string }): void => cb(fromUserId, payload)
      ipcRenderer.on('signaling:dm-reaction', h)
      return () => ipcRenderer.removeListener('signaling:dm-reaction', h)
    },
    onCallInvite: (cb: (fromUserId: string, callData: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromUserId: string, callData: unknown): void => cb(fromUserId, callData)
      ipcRenderer.on('signaling:call-invite', h)
      return () => ipcRenderer.removeListener('signaling:call-invite', h)
    },
    onCallAccept: (cb: (fromUserId: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromUserId: string): void => cb(fromUserId)
      ipcRenderer.on('signaling:call-accept', h)
      return () => ipcRenderer.removeListener('signaling:call-accept', h)
    },
    onCallReject: (cb: (fromUserId: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromUserId: string): void => cb(fromUserId)
      ipcRenderer.on('signaling:call-reject', h)
      return () => ipcRenderer.removeListener('signaling:call-reject', h)
    },
    onCallEnd: (cb: (fromUserId: string) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, fromUserId: string): void => cb(fromUserId)
      ipcRenderer.on('signaling:call-end', h)
      return () => ipcRenderer.removeListener('signaling:call-end', h)
    },
    onFriendRequestIncoming: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:friend-request:incoming', h)
      return () => ipcRenderer.removeListener('signaling:friend-request:incoming', h)
    },
    onFriendRequestAccepted: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:friend-request:accepted', h)
      return () => ipcRenderer.removeListener('signaling:friend-request:accepted', h)
    },
    onFriendRequestRejected: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:friend-request:rejected', h)
      return () => ipcRenderer.removeListener('signaling:friend-request:rejected', h)
    },
    onFriendRequestCancelled: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:friend-request:cancelled', h)
      return () => ipcRenderer.removeListener('signaling:friend-request:cancelled', h)
    },
    onMessageRequestIncoming: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:message-request:incoming', h)
      return () => ipcRenderer.removeListener('signaling:message-request:incoming', h)
    },
    onMessageRequestMessage: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:message-request:message-incoming', h)
      return () => ipcRenderer.removeListener('signaling:message-request:message-incoming', h)
    },
    onServerEvent: (event: string, cb: (payload: unknown) => void): (() => void) => {
      const channel = `signaling:server:${event}`
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on(channel, h)
      return () => ipcRenderer.removeListener(channel, h)
    },
    onPresenceChanged: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:presence:changed', h)
      return () => ipcRenderer.removeListener('signaling:presence:changed', h)
    },
    onStatusChanged: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:status:changed', h)
      return () => ipcRenderer.removeListener('signaling:status:changed', h)
    },
    onStatusSnapshot: (cb: (payload: unknown) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on('signaling:status:snapshot', h)
      return () => ipcRenderer.removeListener('signaling:status:snapshot', h)
    }
  },

  avatar: {
    pickAndSet: (): Promise<{ success: boolean; error?: string; dataUrl?: string }> =>
      ipcRenderer.invoke('avatar:pick-and-set'),
    getSelf: (): Promise<string | null> => ipcRenderer.invoke('avatar:get-self'),
    getSelfBase64: (): Promise<string | null> => ipcRenderer.invoke('avatar:get-self-base64'),
    getForUser: (userId: string): Promise<string | null> =>
      ipcRenderer.invoke('avatar:get-for-user', userId),
    saveForUser: (payload: { userId: string; base64: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('avatar:save-for-user', payload),
    clearSelf: (): Promise<{ success: boolean }> => ipcRenderer.invoke('avatar:clear-self')
  },

  serverAvatar: {
    pickAndSet: (serverId: string): Promise<{ success: boolean; error?: string; dataUrl?: string }> =>
      ipcRenderer.invoke('server-avatar:pick-and-set', { serverId }),
    get: (serverId: string): Promise<string | null> =>
      ipcRenderer.invoke('server-avatar:get', { serverId }),
    getAll: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke('server-avatar:get-all'),
    clear: (serverId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server-avatar:clear', { serverId })
  },

  crypto: {
    hashPassword: (password: string): Promise<string> =>
      ipcRenderer.invoke('crypto:hashPassword', password)
  },

  block: {
    user: (payload: { selfUserId: string; targetUserId: string; targetUsername?: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('block:user', payload),
    unblock: (payload: { targetUserId: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('block:unblock', payload),
    list: (): Promise<Array<{ userId: string; username: string; blockedAt: number }>> =>
      ipcRenderer.invoke('block:list'),
    isBlocked: (payload: { userId: string }): Promise<boolean> =>
      ipcRenderer.invoke('block:is-blocked', payload)
  },

  presence: {
    update: (payload: { username: string; avatarColor: string | null; hidden: boolean }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('presence:update', payload),
    list: (): Promise<Array<{ userId: string; username: string; avatarColor: string | null }>> =>
      ipcRenderer.invoke('presence:list')
  },

  server: {
    create: (payload: { name: string; iconColor: string; hostUserId: string; hostUsername: string; hostAvatarColor: string | null; passwordHash?: string | null }): Promise<{ success: boolean; serverId?: string; error?: string }> =>
      ipcRenderer.invoke('server:create', payload),
    requiresPassword: (payload: { serverId: string }): Promise<boolean> =>
      ipcRenderer.invoke('server:requires-password', payload),
    join: (payload: { serverId: string; userId: string; username: string; avatarColor: string | null; passwordHash?: string | null }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('server:join', payload),
    joinAckPersist: (payload: unknown): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:join-ack-persist', payload),
    memberJoinedPersist: (payload: unknown): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:member-joined-persist', payload),
    leave: (payload: { serverId: string; userId: string; destroy?: boolean }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:leave', payload),
    removeLocal: (serverId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:remove-local', { serverId }),
    sendMessage: (payload: { serverId: string; senderId: string; senderName: string; content: string; channelId?: string | null }): Promise<{ success: boolean; error?: string; messageId?: string }> =>
      ipcRenderer.invoke('server:send-message', payload),
    messageRemote: (payload: { serverId: string; message: { id: string; senderId: string; senderName: string; content: string; timestamp: number; channelId?: string | null } }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:message-remote', payload),
    mute: (payload: { serverId: string; actorId: string; targetId: string; mute: boolean }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:mute', payload),
    kick: (payload: { serverId: string; actorId: string; targetId: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:kick', payload),
    ban: (payload: { serverId: string; actorId: string; targetId: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:ban', payload),
    setRole: (payload: { serverId: string; actorId: string; targetId: string; role: 'moderator' | 'member' }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:set-role', payload),
    applyModeration: (payload: { serverId: string; kind: 'mute' | 'kick' | 'ban' | 'role'; targetId: string; mute?: boolean; role?: 'moderator' | 'member' }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:apply-moderation', payload),
    reregisterMine: (payload: { selfUserId: string }): Promise<{ success: boolean; count: number }> =>
      ipcRenderer.invoke('server:reregister-mine', payload),
    editMessage: (payload: { serverId: string; messageId: string; senderId: string; content: string }): Promise<{ success: boolean; editedAt?: number }> =>
      ipcRenderer.invoke('server:edit-message', payload),
    deleteMessage: (payload: { serverId: string; messageId: string; actorId: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('server:delete-message', payload),
    applyMessageEdit: (payload: { serverId: string; messageId: string; content: string; editedAt: number }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:apply-message-edit', payload),
    applyMessageDelete: (payload: { serverId: string; messageId: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('server:apply-message-delete', payload),

    // Channels / Categories
    listChannels: (serverId: string) =>
      ipcRenderer.invoke('server:list-channels', { serverId }) as Promise<{
        categories: Array<{ id: string; serverId: string; name: string; position: number }>
        channels: Array<{ id: string; serverId: string; categoryId: string | null; name: string; type: 'text' | 'voice'; position: number }>
      }>,
    createCategory: (payload: { serverId: string; actorId: string; name: string }) =>
      ipcRenderer.invoke('server:create-category', payload) as Promise<{ success: boolean; error?: string; categoryId?: string }>,
    createChannel: (payload: { serverId: string; actorId: string; name: string; type: 'text' | 'voice'; categoryId?: string | null }) =>
      ipcRenderer.invoke('server:create-channel', payload) as Promise<{ success: boolean; error?: string; channelId?: string }>,
    renameChannel: (payload: { serverId: string; actorId: string; channelId: string; name: string }) =>
      ipcRenderer.invoke('server:rename-channel', payload) as Promise<{ success: boolean; error?: string }>,
    renameCategory: (payload: { serverId: string; actorId: string; categoryId: string; name: string }) =>
      ipcRenderer.invoke('server:rename-category', payload) as Promise<{ success: boolean; error?: string }>,
    deleteChannel: (payload: { serverId: string; actorId: string; channelId: string }) =>
      ipcRenderer.invoke('server:delete-channel', payload) as Promise<{ success: boolean; error?: string }>,
    deleteCategory: (payload: { serverId: string; actorId: string; categoryId: string }) =>
      ipcRenderer.invoke('server:delete-category', payload) as Promise<{ success: boolean; error?: string }>
  },

  reaction: {
    toggleDm: (payload: { conversationId: string; messageId: string; emojiId: string; userId: string; otherUserId: string; add: boolean }): Promise<{ success: boolean; reactions?: string }> =>
      ipcRenderer.invoke('reaction:toggle-dm', payload),
    toggleServer: (payload: { serverId: string; messageId: string; emojiId: string; userId: string; add: boolean }): Promise<{ success: boolean; reactions?: string }> =>
      ipcRenderer.invoke('reaction:toggle-server', payload),
    applyDm: (payload: { messageId: string; emojiId: string; userId: string; add: boolean }): Promise<{ success: boolean; reactions?: string }> =>
      ipcRenderer.invoke('reaction:apply-dm', payload),
    applyServer: (payload: { messageId: string; emojiId: string; userId: string; add: boolean }): Promise<{ success: boolean; reactions?: string }> =>
      ipcRenderer.invoke('reaction:apply-server', payload)
  },

  friendRequest: {
    send: (payload: { id: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string; timestamp: number }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('friend-request:send', payload),
    accept: (payload: { requestId: string; selfUserId: string; selfUsername: string; selfAvatarColor: string | null }): Promise<{ success: boolean; error?: string; friend?: { userId: string; username: string; avatarColor: string | null } }> =>
      ipcRenderer.invoke('friend-request:accept', payload),
    reject: (payload: { requestId: string; selfUserId: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('friend-request:reject', payload),
    cancel: (payload: { requestId: string; selfUserId: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('friend-request:cancel', payload),
    receive: (payload: { id: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string; timestamp: number }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('friend-request:receive', payload),
    acceptedRemote: (payload: { requestId: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string }): Promise<{ success: boolean; error?: string; friend?: { userId: string; username: string; avatarColor: string | null } }> =>
      ipcRenderer.invoke('friend-request:accepted-remote', payload),
    cancelledRemote: (payload: { requestId: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('friend-request:cancelled-remote', payload),
    rejectedRemote: (payload: { requestId: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('friend-request:rejected-remote', payload)
  },

  messageRequest: {
    send: (payload: { fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string; content: string; timestamp: number }): Promise<{ success: boolean; error?: string; requestId?: string; messageId?: string }> =>
      ipcRenderer.invoke('message-request:send', payload),
    receive: (payload: { requestId: string; messageId: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string; content: string; timestamp: number }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('message-request:receive', payload),
    messageRemote: (payload: { messageId: string; fromUserId: string; fromUsername: string; toUserId: string; content: string; timestamp: number; isReply: boolean }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('message-request:message-remote', payload),
    reply: (payload: { selfUserId: string; selfUsername: string; selfAvatarColor: string | null; otherUserId: string; content: string; timestamp: number }): Promise<{ success: boolean; error?: string; messageId?: string }> =>
      ipcRenderer.invoke('message-request:reply', payload),
    ignore: (payload: { requestId: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('message-request:ignore', payload),
    block: (payload: { otherUserId: string; otherUsername: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('message-request:block', payload),
    thread: (otherUserId: string): Promise<{ id: string; otherUserId: string; senderId: string; senderName: string; content: string; timestamp: number; status: string }[]> =>
      ipcRenderer.invoke('message-request:thread', otherUserId)
  },

  network: {
    scan: (): Promise<{
      signature: { localIp: string | null; routerWanIp: string | null; publicIp: string | null; upnpEnabled: boolean }
      interpretation: { behindCgnat: boolean; directlyReachable: boolean; explanation: string }
    }> => ipcRenderer.invoke('network:scan'),
    cached: (): Promise<{
      signature: { localIp: string | null; routerWanIp: string | null; publicIp: string | null; upnpEnabled: boolean }
      interpretation: { behindCgnat: boolean; directlyReachable: boolean; explanation: string }
    } | null> => ipcRenderer.invoke('network:cached')
  },

  signalingHost: {
    start: (payload?: { port?: number }): Promise<{ success: boolean; error?: string; port?: number }> =>
      ipcRenderer.invoke('signaling-host:start', payload),
    stop: (): Promise<{ success: boolean }> => ipcRenderer.invoke('signaling-host:stop'),
    status: (): Promise<{
      running: boolean
      port: number
      localIps: Array<{ address: string; scope: 'home' | 'isp' | 'public'; label: string; iface: string }>
      error: string | null
    }> => ipcRenderer.invoke('signaling-host:status')
  },

  notifications: {
    show: (payload: {
      type: 'dm' | 'friend-request' | 'call' | 'server-kick' | 'server-message'
      title: string
      body: string
      route?: string
      silent?: boolean
    }): Promise<{ success: boolean }> => ipcRenderer.invoke('notification:show', payload),
    onClicked: (
      cb: (payload: { type: string; route?: string }) => void
    ): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, payload: { type: string; route?: string }): void => cb(payload)
      ipcRenderer.on('notification:clicked', h)
      return () => ipcRenderer.removeListener('notification:clicked', h)
    }
  },

  // Desktop capturer (screen-share source picker)
  desktopGetSources: (opts: {
    types?: Array<'window' | 'screen'>
    thumbnailWidth?: number
    thumbnailHeight?: number
  }): Promise<Array<{
    id: string
    name: string
    display_id: string
    thumbnail: string | null
    appIcon: string | null
  }>> => ipcRenderer.invoke('desktop:getSources', opts),

  // File transfer
  file: {
    pick: (): Promise<string | null> => ipcRenderer.invoke('file:pick'),
    read: (filePath: string): Promise<{ base64: string; fileName: string; fileSize: number; fileType: string } | null> =>
      ipcRenderer.invoke('file:read', filePath),
    saveReceived: (payload: { fileId: string; fileName: string; base64: string }): Promise<{ filePath: string }> =>
      ipcRenderer.invoke('file:save-received', payload),
    readBase64: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('file:read-base64', filePath),
    exists: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('file:exists', filePath),
    open: (filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('file:open', filePath),
    openFolder: (filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('file:open-folder', filePath),
    updateMessagePath: (payload: { messageId: string; filePath: string; isServer?: boolean }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('file:update-message-path', payload),
    maxSize: (): Promise<number> => ipcRenderer.invoke('file:max-size')
  },

  // Relay (node-turn in-process, no external binaries)
  relay: {
    start: (args: { port?: number; scope?: 'isp-local' | 'global' }): Promise<{ success: boolean; error?: string; credentials?: { username: string; password: string } }> =>
      ipcRenderer.invoke('relay:start', args),
    stop: (): Promise<{ success: boolean }> => ipcRenderer.invoke('relay:stop'),
    status: (): Promise<{
      running: boolean
      port: number
      scope: 'isp-local' | 'global'
      connections: number
      credentials: { username: string; password: string } | null
      error: string | null
    }> => ipcRenderer.invoke('relay:status'),
    register: (args: { signalingUrl: string; address: string; scope: 'isp-local' | 'global' }): Promise<{ success: boolean; relayId?: string; error?: string }> =>
      ipcRenderer.invoke('relay:register', args)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
