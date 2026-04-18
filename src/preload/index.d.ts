import { ElectronAPI } from '@electron-toolkit/preload'

interface DbFriendsAPI {
  list: () => Promise<{ userId: string; username: string; avatarColor: string | null; status: string; lastSeen: number | null }[]>
  add: (friend: { userId: string; username: string; avatarColor: string | null; status: string; lastSeen: number | null }) => Promise<void>
  remove: (userId: string) => Promise<void>
  updateStatus: (userId: string, status: string) => Promise<void>
}

interface FriendRequestShape {
  id: string
  fromUserId: string
  fromUsername: string
  fromAvatarColor: string | null
  toUserId: string
  toUsername: string
  toAvatarColor: string | null
  timestamp: number
  direction: 'incoming' | 'outgoing'
}

interface DbFriendRequestsAPI {
  list: () => Promise<FriendRequestShape[]>
  add: (req: FriendRequestShape) => Promise<void>
  remove: (id: string) => Promise<void>
}

interface FriendRequestIncomingPayload {
  id: string
  fromUserId: string
  fromUsername: string
  fromAvatarColor: string | null
  toUserId: string
  timestamp: number
}

interface FriendRequestAcceptedPayload {
  requestId: string
  fromUserId: string
  fromUsername: string
  fromAvatarColor: string | null
  toUserId: string
}

interface FriendRequestRejectedPayload {
  requestId: string
  fromUserId: string
  toUserId: string
}

interface FriendRequestCancelledPayload {
  requestId: string
  fromUserId: string
  toUserId: string
}

interface FriendRequestAPI {
  send: (p: FriendRequestIncomingPayload) => Promise<{ success: boolean; error?: string }>
  accept: (p: { requestId: string; selfUserId: string; selfUsername: string; selfAvatarColor: string | null }) => Promise<{ success: boolean; error?: string; friend?: { userId: string; username: string; avatarColor: string | null } }>
  reject: (p: { requestId: string; selfUserId: string }) => Promise<{ success: boolean; error?: string }>
  cancel: (p: { requestId: string; selfUserId: string }) => Promise<{ success: boolean; error?: string }>
  receive: (p: FriendRequestIncomingPayload) => Promise<{ success: boolean; error?: string }>
  acceptedRemote: (p: FriendRequestAcceptedPayload) => Promise<{ success: boolean; error?: string; friend?: { userId: string; username: string; avatarColor: string | null } }>
  cancelledRemote: (p: { requestId: string }) => Promise<{ success: boolean }>
}

interface MessageRequestShape {
  id: string
  fromUserId: string
  fromUsername: string
  fromAvatarColor: string | null
  toUserId: string
  toUsername: string
  toAvatarColor: string | null
  messagePreview: string
  timestamp: number
  direction: 'incoming' | 'outgoing'
  status: 'pending' | 'replied' | 'ignored'
}

interface MessageRequestThreadMessage {
  id: string
  otherUserId: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  status: string
}

interface DbMessageRequestsAPI {
  list: () => Promise<MessageRequestShape[]>
  add: (req: MessageRequestShape) => Promise<void>
  remove: (id: string) => Promise<void>
}

interface MessageRequestAPI {
  send: (p: { fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string; content: string; timestamp: number }) => Promise<{ success: boolean; error?: string; requestId?: string; messageId?: string }>
  receive: (p: { requestId: string; messageId: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string; content: string; timestamp: number }) => Promise<{ success: boolean; error?: string }>
  messageRemote: (p: { messageId: string; fromUserId: string; fromUsername: string; toUserId: string; content: string; timestamp: number; isReply: boolean }) => Promise<{ success: boolean; error?: string }>
  reply: (p: { selfUserId: string; selfUsername: string; selfAvatarColor: string | null; otherUserId: string; content: string; timestamp: number }) => Promise<{ success: boolean; error?: string; messageId?: string }>
  ignore: (p: { requestId: string }) => Promise<{ success: boolean }>
  block: (p: { otherUserId: string; otherUsername: string }) => Promise<{ success: boolean }>
  thread: (otherUserId: string) => Promise<MessageRequestThreadMessage[]>
}

interface DbConversationsAPI {
  list: () => Promise<{ id: string; recipientId: string; recipientName: string; recipientAvatarColor: string | null; recipientStatus: string; unreadCount: number }[]>
  upsert: (conv: { id: string; recipientId: string; recipientName: string; recipientAvatarColor: string | null; recipientStatus: string; unreadCount: number }) => Promise<void>
  updateUnread: (id: string, unreadCount: number) => Promise<void>
}

interface DbMessagesAPI {
  list: (args: { conversationId: string; limit?: number; before?: number }) => Promise<{ id: string; conversationId: string; senderId: string; senderName: string; content: string; timestamp: number; status: string; fileId?: string | null; fileName?: string | null; fileSize?: number | null; fileType?: string | null; filePath?: string | null; editedAt?: number | null; isDeleted?: number }[]>
  send: (msg: unknown) => Promise<void>
  updateStatus: (id: string, status: string) => Promise<void>
  edit: (id: string, content: string, editedAt: number) => Promise<void>
  delete: (id: string) => Promise<void>
  get: (id: string) => Promise<unknown>
}

interface DbServersAPI {
  list: () => Promise<{ id: string; name: string; iconColor: string; role: string; textChannelName: string; voiceRoomName: string; memberCount: number; onlineMemberCount: number }[]>
  add: (server: { id: string; name: string; iconColor: string; role: string; textChannelName: string; voiceRoomName: string; memberCount: number; onlineMemberCount: number }) => Promise<void>
  remove: (serverId: string) => Promise<void>
}

interface DbServerMembersAPI {
  list: (serverId: string) => Promise<{ serverId: string; userId: string; username: string; avatarColor: string | null; role: string; status: string; isMuted: number }[]>
  add: (member: { serverId: string; userId: string; username: string; avatarColor: string | null; role: string; status: string; isMuted: number }) => Promise<void>
}

interface DbServerMessagesAPI {
  list: (args: { serverId: string; limit?: number; before?: number }) => Promise<{ id: string; serverId: string; senderId: string; senderName: string; content: string; timestamp: number; status: string; editedAt?: number | null; isDeleted?: number }[]>
  send: (msg: unknown) => Promise<void>
  edit: (id: string, content: string, editedAt: number) => Promise<void>
  delete: (id: string) => Promise<void>
}

interface DbBlockedAPI {
  list: () => Promise<{ userId: string; username: string; blockedAt: number }[]>
  add: (userId: string, username: string) => Promise<void>
  remove: (userId: string) => Promise<void>
}

interface DbRelaysAPI {
  list: () => Promise<{ id: string; address: string; scope: string; latency: number | null; users: number; isCustom: number }[]>
  add: (relay: { id: string; address: string; scope: string; latency: number | null; users: number; isCustom: number }) => Promise<void>
  remove: (id: string) => Promise<void>
}

interface DbSettingsAPI {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
}

interface DbAPI {
  friends: DbFriendsAPI
  friendRequests: DbFriendRequestsAPI
  messageRequests: DbMessageRequestsAPI
  conversations: DbConversationsAPI
  messages: DbMessagesAPI
  servers: DbServersAPI
  serverMembers: DbServerMembersAPI
  serverMessages: DbServerMessagesAPI
  blocked: DbBlockedAPI
  relays: DbRelaysAPI
  settings: DbSettingsAPI
}

interface SignalingAPI {
  connect: (serverUrl: string, userId: string) => Promise<void>
  disconnect: () => Promise<void>
  isConnected: () => Promise<boolean>
  socketId: () => Promise<string | null>
  emit: (event: string, ...args: unknown[]) => void

  onConnected: (cb: () => void) => () => void
  onReconnectStatus: (cb: (payload: { state: 'reconnecting' | 'connected' | 'failed'; attempt?: number; max?: number }) => void) => () => void
  onDisconnected: (cb: (reason: string) => void) => () => void
  onError: (cb: (message: string) => void) => () => void
  onUserJoined: (cb: (userId: string, socketId: string) => void) => () => void
  onUserLeft: (cb: (userId: string, socketId: string) => void) => () => void
  onOffer: (cb: (fromSocketId: string, offer: RTCSessionDescriptionInit, fromUserId: string) => void) => () => void
  onAnswer: (cb: (fromSocketId: string, answer: RTCSessionDescriptionInit) => void) => () => void
  onIceCandidate: (cb: (fromSocketId: string, candidate: RTCIceCandidateInit) => void) => () => void
  onDmMessage: (cb: (fromUserId: string, message: string) => void) => () => void
  onDmEdit: (cb: (fromUserId: string, payload: { messageId: string; content: string; editedAt: number }) => void) => () => void
  onDmDelete: (cb: (fromUserId: string, payload: { messageId: string }) => void) => () => void
  onDmReaction: (cb: (fromUserId: string, payload: { messageId: string; emojiId: string; add: boolean; userId: string }) => void) => () => void
  onCallInvite: (cb: (fromUserId: string, callData: unknown) => void) => () => void
  onCallAccept: (cb: (fromUserId: string) => void) => () => void
  onCallReject: (cb: (fromUserId: string) => void) => () => void
  onCallEnd: (cb: (fromUserId: string) => void) => () => void
  onFriendRequestIncoming: (cb: (payload: FriendRequestIncomingPayload) => void) => () => void
  onFriendRequestAccepted: (cb: (payload: FriendRequestAcceptedPayload) => void) => () => void
  onFriendRequestRejected: (cb: (payload: FriendRequestRejectedPayload) => void) => () => void
  onFriendRequestCancelled: (cb: (payload: FriendRequestCancelledPayload) => void) => () => void
  onMessageRequestIncoming: (cb: (payload: { requestId: string; messageId: string; fromUserId: string; fromUsername: string; fromAvatarColor: string | null; toUserId: string; content: string; timestamp: number }) => void) => () => void
  onMessageRequestMessage: (cb: (payload: { messageId: string; fromUserId: string; fromUsername: string; toUserId: string; content: string; timestamp: number; isReply: boolean }) => void) => () => void
  onServerEvent: (event: string, cb: (payload: unknown) => void) => () => void
  onPresenceChanged: (cb: (payload: { userId: string; username?: string; avatarColor?: string | null; hidden?: boolean; removed?: true }) => void) => () => void
  onStatusChanged: (cb: (payload: { userId: string; status: 'online' | 'idle' | 'offline'; lastSeen: number }) => void) => () => void
  onStatusSnapshot: (cb: (payload: Array<{ userId: string; status: 'online' | 'idle' | 'offline'; lastSeen: number }>) => void) => () => void
}

interface AvatarAPI {
  pickAndSet: () => Promise<{ success: boolean; error?: string; dataUrl?: string }>
  getSelf: () => Promise<string | null>
  getSelfBase64: () => Promise<string | null>
  getForUser: (userId: string) => Promise<string | null>
  saveForUser: (p: { userId: string; base64: string }) => Promise<{ success: boolean; error?: string }>
  clearSelf: () => Promise<{ success: boolean }>
}

interface ServerAvatarAPI {
  pickAndSet: (serverId: string) => Promise<{ success: boolean; error?: string; dataUrl?: string }>
  get: (serverId: string) => Promise<string | null>
  getAll: () => Promise<Record<string, string>>
  clear: (serverId: string) => Promise<{ success: boolean }>
}

interface BlockAPI {
  user: (p: { selfUserId: string; targetUserId: string; targetUsername?: string }) => Promise<{ success: boolean; error?: string }>
  unblock: (p: { targetUserId: string }) => Promise<{ success: boolean }>
  list: () => Promise<Array<{ userId: string; username: string; blockedAt: number }>>
  isBlocked: (p: { userId: string }) => Promise<boolean>
}

interface PresenceAPI {
  update: (p: { username: string; avatarColor: string | null; hidden: boolean }) => Promise<{ success: boolean }>
  list: () => Promise<Array<{ userId: string; username: string; avatarColor: string | null }>>
}

interface ServerAPI {
  create: (p: { name: string; iconColor: string; textChannelName: string; voiceRoomName: string; hostUserId: string; hostUsername: string; hostAvatarColor: string | null; passwordHash?: string | null }) => Promise<{ success: boolean; error?: string; serverId?: string }>
  requiresPassword: (p: { serverId: string }) => Promise<boolean>
  join: (p: { serverId: string; userId: string; username: string; avatarColor: string | null; passwordHash?: string | null }) => Promise<{ success: boolean; error?: string }>
  joinAckPersist: (p: unknown) => Promise<{ success: boolean }>
  memberJoinedPersist: (p: unknown) => Promise<{ success: boolean }>
  leave: (p: { serverId: string; userId: string; destroy?: boolean }) => Promise<{ success: boolean }>
  removeLocal: (serverId: string) => Promise<{ success: boolean }>
  sendMessage: (p: { serverId: string; senderId: string; senderName: string; content: string }) => Promise<{ success: boolean; error?: string; messageId?: string }>
  messageRemote: (p: { serverId: string; message: { id: string; senderId: string; senderName: string; content: string; timestamp: number } }) => Promise<{ success: boolean }>
  mute: (p: { serverId: string; actorId: string; targetId: string; mute: boolean }) => Promise<{ success: boolean }>
  kick: (p: { serverId: string; actorId: string; targetId: string }) => Promise<{ success: boolean }>
  ban: (p: { serverId: string; actorId: string; targetId: string }) => Promise<{ success: boolean }>
  setRole: (p: { serverId: string; actorId: string; targetId: string; role: 'moderator' | 'member' }) => Promise<{ success: boolean }>
  applyModeration: (p: { serverId: string; kind: 'mute' | 'kick' | 'ban' | 'role'; targetId: string; mute?: boolean; role?: 'moderator' | 'member' }) => Promise<{ success: boolean }>
  reregisterMine: (p: { selfUserId: string }) => Promise<{ success: boolean; count: number }>
  editMessage: (p: { serverId: string; messageId: string; senderId: string; content: string }) => Promise<{ success: boolean; editedAt?: number }>
  deleteMessage: (p: { serverId: string; messageId: string; actorId: string }) => Promise<{ success: boolean; error?: string }>
  applyMessageEdit: (p: { serverId: string; messageId: string; content: string; editedAt: number }) => Promise<{ success: boolean }>
  applyMessageDelete: (p: { serverId: string; messageId: string }) => Promise<{ success: boolean }>
}

interface NetworkSignature {
  localIp: string | null
  routerWanIp: string | null
  publicIp: string | null
  upnpEnabled: boolean
}

interface NetworkInterpretation {
  behindCgnat: boolean
  directlyReachable: boolean
  explanation: string
}

interface NetworkScanAPI {
  scan: () => Promise<{ signature: NetworkSignature; interpretation: NetworkInterpretation }>
  cached: () => Promise<{ signature: NetworkSignature; interpretation: NetworkInterpretation } | null>
}

interface SignalingHostAPI {
  start: (p?: { port?: number }) => Promise<{ success: boolean; error?: string; port?: number }>
  stop: () => Promise<{ success: boolean }>
  status: () => Promise<{
    running: boolean
    port: number
    localIps: Array<{ address: string; scope: 'home' | 'isp' | 'public'; label: string; iface: string }>
    error: string | null
  }>
}

interface NotificationsAPI {
  show: (p: {
    type: 'dm' | 'friend-request' | 'call' | 'server-kick' | 'server-message'
    title: string
    body: string
    route?: string
    silent?: boolean
  }) => Promise<{ success: boolean }>
  onClicked: (cb: (p: { type: string; route?: string }) => void) => () => void
}

interface FileAPI {
  pick: () => Promise<string | null>
  read: (filePath: string) => Promise<{ base64: string; fileName: string; fileSize: number; fileType: string } | null>
  saveReceived: (p: { fileId: string; fileName: string; base64: string }) => Promise<{ filePath: string }>
  readBase64: (filePath: string) => Promise<string | null>
  exists: (filePath: string) => Promise<boolean>
  open: (filePath: string) => Promise<{ success: boolean }>
  openFolder: (filePath: string) => Promise<{ success: boolean }>
  updateMessagePath: (p: { messageId: string; filePath: string; isServer?: boolean }) => Promise<{ success: boolean }>
  maxSize: () => Promise<number>
}

interface RelayStatus {
  running: boolean
  port: number
  scope: 'isp-local' | 'global'
  connections: number
  credentials: { username: string; password: string } | null
  error: string | null
}

interface ReactionAPI {
  toggleDm: (p: { conversationId: string; messageId: string; emojiId: string; userId: string; otherUserId: string; add: boolean }) => Promise<{ success: boolean; reactions?: string }>
  toggleServer: (p: { serverId: string; messageId: string; emojiId: string; userId: string; add: boolean }) => Promise<{ success: boolean; reactions?: string }>
  applyDm: (p: { messageId: string; emojiId: string; userId: string; add: boolean }) => Promise<{ success: boolean; reactions?: string }>
  applyServer: (p: { messageId: string; emojiId: string; userId: string; add: boolean }) => Promise<{ success: boolean; reactions?: string }>
}

interface RelayAPI {
  start: (args: { port?: number; scope?: 'isp-local' | 'global' }) => Promise<{ success: boolean; error?: string; credentials?: { username: string; password: string } }>
  stop: () => Promise<{ success: boolean }>
  status: () => Promise<RelayStatus>
  register: (args: { signalingUrl: string; address: string; scope: 'isp-local' | 'global' }) => Promise<{ success: boolean; relayId?: string; error?: string }>
}

interface CryptoAPI {
  hashPassword: (password: string) => Promise<string>
}

interface MeshAPI {
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void

  // Identity
  identityExists: () => Promise<boolean>
  identityGenerate: (args: { username: string; avatarColor: string | null }) => Promise<{ userId: string; publicKey: string }>
  identityLoad: () => Promise<{
    userId: string
    publicKey: string
    username: string
    avatarColor: string | null
    createdAt: number
  } | null>

  // Database
  db: DbAPI

  // Crypto
  crypto: CryptoAPI

  // Signaling
  signaling: SignalingAPI

  // Relay (local coturn)
  relay: RelayAPI

  // Friend requests (orchestrated through main process)
  friendRequest: FriendRequestAPI

  // Message requests (cold messages to non-friends)
  messageRequest: MessageRequestAPI

  // Community servers
  server: ServerAPI

  // Presence / discovery (People Nearby)
  presence: PresenceAPI

  // Block system
  block: BlockAPI

  // Profile pictures
  avatar: AvatarAPI

  // Server avatars
  serverAvatar: ServerAvatarAPI

  // Desktop notifications
  notifications: NotificationsAPI

  // Embedded signaling host
  signalingHost: SignalingHostAPI

  // Network topology scanner (CGNAT detection)
  network: NetworkScanAPI

  // File transfer
  file: FileAPI

  // Desktop capturer (screen-share source picker)
  desktopGetSources: (opts: {
    types?: Array<'window' | 'screen'>
    thumbnailWidth?: number
    thumbnailHeight?: number
  }) => Promise<Array<{
    id: string
    name: string
    display_id: string
    thumbnail: string | null
    appIcon: string | null
  }>>

  // Reactions
  reaction: ReactionAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: MeshAPI
  }
}
