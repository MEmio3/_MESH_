export interface FileAttachment {
  fileId: string
  fileName: string
  fileSize: number
  fileType: string
  filePath?: string | null
  base64?: string  // For inline preview before save
  transferProgress?: number  // 0-100
}

/** Map of emoji-mart native emoji string → list of userIds who reacted with it. */
export type ReactionMap = Record<string, string[]>

export interface Message {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  status: 'sending' | 'sent' | 'delivered' | 'read'
  file?: FileAttachment | null
  editedAt?: number | null
  isDeleted?: boolean
  reactions?: ReactionMap
  replyTo?: { messageId: string; senderName: string; content: string } | null
  /** For server messages: which channel this message belongs to. Null/undefined for DMs. */
  channelId?: string | null
}

export interface Conversation {
  id: string
  recipientId: string
  recipientName: string
  recipientAvatarColor: string | null
  recipientStatus: 'online' | 'offline' | 'idle' | 'dnd'
  messages: Message[]
  unreadCount: number
  lastMessage: Message | null
}
