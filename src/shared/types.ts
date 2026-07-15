/**
 * Shared types used in IPC communication between main and renderer processes.
 * These types define the shape of data flowing through the contextBridge.
 */

// ── Identity ──

export interface IdentityData {
  userId: string
  publicKey: string
  username: string
  avatarColor: string | null
  createdAt: number
}

// ── Social ──

export interface FriendRow {
  userId: string
  username: string
  avatarColor: string | null
  status: string
  lastSeen: number | null
}

export interface FriendRequestRow {
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

export interface MessageRequestRow {
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

export interface MessageRequestMessageRow {
  id: string
  otherUserId: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  status: string
}

export interface BlockedUserRow {
  userId: string
  username: string
  blockedAt: number
}

// ── Messages ──

export interface ConversationRow {
  id: string
  recipientId: string
  recipientName: string
  recipientAvatarColor: string | null
  recipientStatus: string
  unreadCount: number
}

export interface MessageRow {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  status: string
  fileId: string | null
  fileName: string | null
  fileSize: number | null
  fileType: string | null
  filePath: string | null
  editedAt: number | null
  isDeleted: number
  reactions: string
  replyToId?: string | null
  replyToSenderName?: string | null
  replyToContent?: string | null
  isPinned?: number
}

export type MessageSearchKind = 'all' | 'files' | 'images' | 'links' | 'code'

export interface MessageSearchQuery {
  query?: string
  author?: string
  kind?: MessageSearchKind
  after?: number
  before?: number
  limit?: number
}

export type InboxSourceType = 'dm' | 'server'
export type InboxFilter = 'unread' | 'mentions' | 'replies'
export type InboxNotificationMode = 'all' | 'mentions' | 'muted'

export interface InboxRecordInput {
  messageId: string
  scopeKey: string
  sourceType: InboxSourceType
  conversationId?: string | null
  serverId?: string | null
  channelId?: string | null
  sourceName: string
  channelName?: string | null
  senderId: string
  senderName: string
  content: string
  timestamp: number
  replyToId?: string | null
  selfUserId: string
  isMention?: boolean
  isRead?: boolean
  fileName?: string | null
  fileType?: string | null
}

export interface InboxItemRow {
  messageId: string
  scopeKey: string
  sourceType: InboxSourceType
  conversationId: string | null
  serverId: string | null
  channelId: string | null
  sourceName: string
  channelName: string | null
  senderId: string
  senderName: string
  content: string
  timestamp: number
  isMention: number
  isReply: number
  isRead: number
  fileName: string | null
  fileType: string | null
}

export interface InboxCountRow {
  scopeKey: string
  sourceType: InboxSourceType
  conversationId: string | null
  serverId: string | null
  channelId: string | null
  unreadCount: number
  mentionCount: number
  replyCount: number
}

export interface InboxPreferenceRow {
  scopeKey: string
  mode: InboxNotificationMode
}

export interface FileTransferMeta {
  fileId: string
  fileName: string
  fileSize: number
  fileType: string
  totalChunks: number
}

// ── Servers ──

export interface ServerRow {
  id: string
  name: string
  iconColor: string
  role: string
  textChannelName: string
  voiceRoomName: string
  memberCount: number
  onlineMemberCount: number
  hostUserId: string
  hostUsername: string
  hostAvatarColor: string | null
  banned: string // JSON array of userIds
  passwordHash?: string | null
  /** JSON {host,moderator,member} display names, null = defaults. */
  roleNames?: string | null
}

/** A custom role defined by the server host (Discord-style). */
export interface ServerRoleRow {
  id: string
  serverId: string
  name: string
  color: string
  position: number
  /** Legacy flag — superseded by `permissions`; kept for migration. */
  canModerate: number
  /** Permission bitmask (see shared/permissions.ts). */
  permissions: number
}

export interface ServerMemberRow {
  serverId: string
  userId: string
  username: string
  avatarColor: string | null
  role: string
  status: string
  isMuted: number
  /** JSON array of custom role ids assigned to this member. */
  roleIds: string
}

export interface ServerCategoryRow {
  id: string
  serverId: string
  name: string
  position: number
}

export interface ServerChannelRow {
  id: string
  serverId: string
  categoryId: string | null
  name: string
  type: 'text' | 'voice'
  position: number
  /** Minimum role that can see/enter this channel (legacy tier gate). */
  minRole: 'member' | 'moderator' | 'host'
  /** JSON array of custom role ids allowed to see this channel; null = everyone.
   *  When set, it takes precedence over minRole. Host always sees everything. */
  allowedRoleIds: string | null
  /** Voice: target audio bitrate in kbps; null = codec default. */
  bitrateKbps: number | null
  /** Voice: max simultaneous members; 0 = unlimited. Host bypasses. */
  userLimit: number
  /** Text: JSON array of role ids allowed to send; null = everyone with the
   *  global Send Messages permission. Host always may send. */
  sendRoleIds: string | null
  /** JSON ChannelOverrides (see shared/permissions.ts); null = no overrides. */
  permissionOverrides: string | null
}

export interface ServerMessageRow {
  id: string
  serverId: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  status: string
  fileId: string | null
  fileName: string | null
  fileSize: number | null
  fileType: string | null
  filePath: string | null
  editedAt: number | null
  isDeleted: number
  reactions: string
  channelId: string | null
  replyToId?: string | null
  replyToSenderName?: string | null
  replyToContent?: string | null
  isPinned?: number
}

// ── Relays ──

export interface RelayRow {
  id: string
  address: string
  scope: string
  latency: number | null
  users: number
  isCustom: number
  /** TURN long-term credentials — REQUIRED to get relay candidates from an
   *  authenticated relay; a turn: url without them is silently useless. */
  username: string | null
  password: string | null
}
