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
}

export interface ServerMemberRow {
  serverId: string
  userId: string
  username: string
  avatarColor: string | null
  role: string
  status: string
  isMuted: number
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
}

// ── Relays ──

export interface RelayRow {
  id: string
  address: string
  scope: string
  latency: number | null
  users: number
  isCustom: number
}
