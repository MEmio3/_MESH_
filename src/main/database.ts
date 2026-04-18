import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type {
  FriendRow,
  FriendRequestRow,
  MessageRequestRow,
  MessageRequestMessageRow,
  BlockedUserRow,
  ConversationRow,
  MessageRow,
  ServerRow,
  ServerMemberRow,
  ServerMessageRow,
  ServerCategoryRow,
  ServerChannelRow,
  RelayRow
} from '../shared/types'

let db: Database.Database | null = null

// ── Lifecycle ──

export function openDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'mesh.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createTables()
  migrateSchema()
  seedDefaultServerChannelsIfMissing()
}

export function closeDatabase(): void {
  db?.close()
  db = null
}

function getDb(): Database.Database {
  if (!db) throw new Error('Database not open')
  return db
}

function migrateSchema(): void {
  const d = getDb()
  // Additive migrations for columns introduced after v0.
  const cols = d.prepare("PRAGMA table_info('friend_requests')").all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  if (cols.length > 0) {
    if (!names.has('to_user_id')) d.exec("ALTER TABLE friend_requests ADD COLUMN to_user_id TEXT NOT NULL DEFAULT ''")
    if (!names.has('to_username')) d.exec("ALTER TABLE friend_requests ADD COLUMN to_username TEXT NOT NULL DEFAULT ''")
    if (!names.has('to_avatar_color')) d.exec('ALTER TABLE friend_requests ADD COLUMN to_avatar_color TEXT')
  }

  const mreqCols = d.prepare("PRAGMA table_info('message_requests')").all() as { name: string }[]
  const mreqNames = new Set(mreqCols.map((c) => c.name))
  if (mreqCols.length > 0) {
    if (!mreqNames.has('to_user_id')) d.exec("ALTER TABLE message_requests ADD COLUMN to_user_id TEXT NOT NULL DEFAULT ''")
    if (!mreqNames.has('to_username')) d.exec("ALTER TABLE message_requests ADD COLUMN to_username TEXT NOT NULL DEFAULT ''")
    if (!mreqNames.has('to_avatar_color')) d.exec('ALTER TABLE message_requests ADD COLUMN to_avatar_color TEXT')
    if (!mreqNames.has('direction')) d.exec("ALTER TABLE message_requests ADD COLUMN direction TEXT NOT NULL DEFAULT 'incoming'")
    if (!mreqNames.has('status')) d.exec("ALTER TABLE message_requests ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'")
  }

  // File attachment columns on messages
  const msgCols = d.prepare("PRAGMA table_info('messages')").all() as { name: string }[]
  const msgNames = new Set(msgCols.map((c) => c.name))
  if (msgCols.length > 0) {
    if (!msgNames.has('file_id')) d.exec('ALTER TABLE messages ADD COLUMN file_id TEXT')
    if (!msgNames.has('file_name')) d.exec('ALTER TABLE messages ADD COLUMN file_name TEXT')
    if (!msgNames.has('file_size')) d.exec('ALTER TABLE messages ADD COLUMN file_size INTEGER')
    if (!msgNames.has('file_type')) d.exec('ALTER TABLE messages ADD COLUMN file_type TEXT')
    if (!msgNames.has('file_path')) d.exec('ALTER TABLE messages ADD COLUMN file_path TEXT')
    if (!msgNames.has('edited_at')) d.exec('ALTER TABLE messages ADD COLUMN edited_at INTEGER')
    if (!msgNames.has('is_deleted')) d.exec('ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0')
    if (!msgNames.has('reactions')) d.exec("ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}'")
  }

  // File attachment columns on server_messages
  const smsgCols = d.prepare("PRAGMA table_info('server_messages')").all() as { name: string }[]
  const smsgNames = new Set(smsgCols.map((c) => c.name))
  if (smsgCols.length > 0) {
    if (!smsgNames.has('file_id')) d.exec('ALTER TABLE server_messages ADD COLUMN file_id TEXT')
    if (!smsgNames.has('file_name')) d.exec('ALTER TABLE server_messages ADD COLUMN file_name TEXT')
    if (!smsgNames.has('file_size')) d.exec('ALTER TABLE server_messages ADD COLUMN file_size INTEGER')
    if (!smsgNames.has('file_type')) d.exec('ALTER TABLE server_messages ADD COLUMN file_type TEXT')
    if (!smsgNames.has('file_path')) d.exec('ALTER TABLE server_messages ADD COLUMN file_path TEXT')
    if (!smsgNames.has('edited_at')) d.exec('ALTER TABLE server_messages ADD COLUMN edited_at INTEGER')
    if (!smsgNames.has('is_deleted')) d.exec('ALTER TABLE server_messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0')
    if (!smsgNames.has('reactions')) d.exec("ALTER TABLE server_messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}'")
    if (!smsgNames.has('channel_id')) d.exec('ALTER TABLE server_messages ADD COLUMN channel_id TEXT')
  }

  const srvCols = d.prepare("PRAGMA table_info('servers')").all() as { name: string }[]
  const srvNames = new Set(srvCols.map((c) => c.name))
  if (srvCols.length > 0) {
    if (!srvNames.has('host_user_id')) d.exec("ALTER TABLE servers ADD COLUMN host_user_id TEXT NOT NULL DEFAULT ''")
    if (!srvNames.has('host_username')) d.exec("ALTER TABLE servers ADD COLUMN host_username TEXT NOT NULL DEFAULT ''")
    if (!srvNames.has('host_avatar_color')) d.exec('ALTER TABLE servers ADD COLUMN host_avatar_color TEXT')
    if (!srvNames.has('banned')) d.exec("ALTER TABLE servers ADD COLUMN banned TEXT NOT NULL DEFAULT '[]'")
    if (!srvNames.has('password_hash')) d.exec("ALTER TABLE servers ADD COLUMN password_hash TEXT")
  }
}

function createTables(): void {
  const d = getDb()

  d.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      avatar_color TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen INTEGER
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      from_username TEXT NOT NULL,
      from_avatar_color TEXT,
      to_user_id TEXT NOT NULL DEFAULT '',
      to_username TEXT NOT NULL DEFAULT '',
      to_avatar_color TEXT,
      timestamp INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing'))
    );

    CREATE TABLE IF NOT EXISTS message_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      from_username TEXT NOT NULL,
      from_avatar_color TEXT,
      to_user_id TEXT NOT NULL DEFAULT '',
      to_username TEXT NOT NULL DEFAULT '',
      to_avatar_color TEXT,
      message_preview TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      direction TEXT NOT NULL DEFAULT 'incoming' CHECK (direction IN ('incoming','outgoing')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','replied','ignored'))
    );

    CREATE TABLE IF NOT EXISTS message_request_messages (
      id TEXT PRIMARY KEY,
      other_user_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent'
    );
    CREATE INDEX IF NOT EXISTS idx_mreq_msgs_user_ts ON message_request_messages(other_user_id, timestamp);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_avatar_color TEXT,
      recipient_status TEXT NOT NULL DEFAULT 'offline',
      unread_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv_ts ON messages(conversation_id, timestamp);

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_color TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      text_channel_name TEXT NOT NULL DEFAULT 'general',
      voice_room_name TEXT NOT NULL DEFAULT 'Voice Lounge',
      member_count INTEGER NOT NULL DEFAULT 0,
      online_member_count INTEGER NOT NULL DEFAULT 0,
      host_user_id TEXT NOT NULL DEFAULT '',
      host_username TEXT NOT NULL DEFAULT '',
      host_avatar_color TEXT,
      banned TEXT NOT NULL DEFAULT '[]',
      password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS server_members (
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar_color TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'offline',
      is_muted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (server_id, user_id),
      FOREIGN KEY (server_id) REFERENCES servers(id)
    );

    CREATE TABLE IF NOT EXISTS server_categories (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (server_id) REFERENCES servers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_server_categories_server ON server_categories(server_id, position);

    CREATE TABLE IF NOT EXISTS server_channels (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (server_id) REFERENCES servers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_server_channels_server ON server_channels(server_id, position);

    CREATE TABLE IF NOT EXISTS server_messages (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      FOREIGN KEY (server_id) REFERENCES servers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_srv_messages_srv_ts ON server_messages(server_id, timestamp);

    CREATE TABLE IF NOT EXISTS relays (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      latency INTEGER,
      users INTEGER DEFAULT 0,
      is_custom INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      blocked_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

// ── Friends ──

export function getFriends(): FriendRow[] {
  return getDb().prepare('SELECT user_id AS userId, username, avatar_color AS avatarColor, status, last_seen AS lastSeen FROM friends').all() as FriendRow[]
}

export function addFriend(f: FriendRow): void {
  getDb().prepare('INSERT OR REPLACE INTO friends (user_id, username, avatar_color, status, last_seen) VALUES (?, ?, ?, ?, ?)').run(f.userId, f.username, f.avatarColor, f.status, f.lastSeen)
}

export function removeFriend(userId: string): void {
  getDb().prepare('DELETE FROM friends WHERE user_id = ?').run(userId)
}

export function updateFriendStatus(userId: string, status: string): void {
  getDb().prepare('UPDATE friends SET status = ? WHERE user_id = ?').run(status, userId)
}

// ── Friend Requests ──

export function getFriendRequests(): FriendRequestRow[] {
  return getDb().prepare('SELECT id, from_user_id AS fromUserId, from_username AS fromUsername, from_avatar_color AS fromAvatarColor, to_user_id AS toUserId, to_username AS toUsername, to_avatar_color AS toAvatarColor, timestamp, direction FROM friend_requests').all() as FriendRequestRow[]
}

export function addFriendRequest(r: FriendRequestRow): void {
  getDb().prepare('INSERT OR REPLACE INTO friend_requests (id, from_user_id, from_username, from_avatar_color, to_user_id, to_username, to_avatar_color, timestamp, direction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(r.id, r.fromUserId, r.fromUsername, r.fromAvatarColor, r.toUserId, r.toUsername, r.toAvatarColor, r.timestamp, r.direction)
}

export function removeFriendRequest(id: string): void {
  getDb().prepare('DELETE FROM friend_requests WHERE id = ?').run(id)
}

export function findFriendRequestBetween(userA: string, userB: string): FriendRequestRow | null {
  const row = getDb().prepare(
    'SELECT id, from_user_id AS fromUserId, from_username AS fromUsername, from_avatar_color AS fromAvatarColor, to_user_id AS toUserId, to_username AS toUsername, to_avatar_color AS toAvatarColor, timestamp, direction FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?) LIMIT 1'
  ).get(userA, userB, userB, userA) as FriendRequestRow | undefined
  return row ?? null
}

export function removeFriendRequestsBetween(userA: string, userB: string): void {
  getDb().prepare('DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)').run(userA, userB, userB, userA)
}

export function findFriend(userId: string): FriendRow | null {
  const row = getDb().prepare('SELECT user_id AS userId, username, avatar_color AS avatarColor, status, last_seen AS lastSeen FROM friends WHERE user_id = ?').get(userId) as FriendRow | undefined
  return row ?? null
}

export function findBlocked(userId: string): BlockedUserRow | null {
  const row = getDb().prepare('SELECT user_id AS userId, username, blocked_at AS blockedAt FROM blocked_users WHERE user_id = ?').get(userId) as BlockedUserRow | undefined
  return row ?? null
}

// ── Message Requests ──

const MREQ_COLS = 'id, from_user_id AS fromUserId, from_username AS fromUsername, from_avatar_color AS fromAvatarColor, to_user_id AS toUserId, to_username AS toUsername, to_avatar_color AS toAvatarColor, message_preview AS messagePreview, timestamp, direction, status'

export function getMessageRequests(): MessageRequestRow[] {
  return getDb().prepare(`SELECT ${MREQ_COLS} FROM message_requests ORDER BY timestamp DESC`).all() as MessageRequestRow[]
}

export function addMessageRequest(r: MessageRequestRow): void {
  getDb().prepare(
    'INSERT OR REPLACE INTO message_requests (id, from_user_id, from_username, from_avatar_color, to_user_id, to_username, to_avatar_color, message_preview, timestamp, direction, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(r.id, r.fromUserId, r.fromUsername, r.fromAvatarColor, r.toUserId, r.toUsername, r.toAvatarColor, r.messagePreview, r.timestamp, r.direction, r.status)
}

export function removeMessageRequest(id: string): void {
  getDb().prepare('DELETE FROM message_requests WHERE id = ?').run(id)
}

export function findMessageRequestByOther(otherUserId: string): MessageRequestRow | null {
  const row = getDb().prepare(
    `SELECT ${MREQ_COLS} FROM message_requests WHERE (direction = 'incoming' AND from_user_id = ?) OR (direction = 'outgoing' AND to_user_id = ?) LIMIT 1`
  ).get(otherUserId, otherUserId) as MessageRequestRow | undefined
  return row ?? null
}

export function updateMessageRequestStatus(id: string, status: 'pending' | 'replied' | 'ignored', preview?: string, timestamp?: number): void {
  if (preview !== undefined && timestamp !== undefined) {
    getDb().prepare('UPDATE message_requests SET status = ?, message_preview = ?, timestamp = ? WHERE id = ?').run(status, preview, timestamp, id)
  } else {
    getDb().prepare('UPDATE message_requests SET status = ? WHERE id = ?').run(status, id)
  }
}

export function deleteMessageRequestThread(otherUserId: string): void {
  const d = getDb()
  d.prepare(`DELETE FROM message_requests WHERE (direction = 'incoming' AND from_user_id = ?) OR (direction = 'outgoing' AND to_user_id = ?)`).run(otherUserId, otherUserId)
  d.prepare('DELETE FROM message_request_messages WHERE other_user_id = ?').run(otherUserId)
}

// Thread messages
export function getMessageRequestThread(otherUserId: string, limit = 100): MessageRequestMessageRow[] {
  return getDb().prepare(
    'SELECT id, other_user_id AS otherUserId, sender_id AS senderId, sender_name AS senderName, content, timestamp, status FROM message_request_messages WHERE other_user_id = ? ORDER BY timestamp ASC LIMIT ?'
  ).all(otherUserId, limit) as MessageRequestMessageRow[]
}

export function insertMessageRequestMessage(m: MessageRequestMessageRow): void {
  getDb().prepare(
    'INSERT OR REPLACE INTO message_request_messages (id, other_user_id, sender_id, sender_name, content, timestamp, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(m.id, m.otherUserId, m.senderId, m.senderName, m.content, m.timestamp, m.status)
}

// ── Conversations ──

export function getConversations(): ConversationRow[] {
  return getDb().prepare('SELECT id, recipient_id AS recipientId, recipient_name AS recipientName, recipient_avatar_color AS recipientAvatarColor, recipient_status AS recipientStatus, unread_count AS unreadCount FROM conversations ORDER BY id').all() as ConversationRow[]
}

export function upsertConversation(c: ConversationRow): void {
  getDb().prepare(`INSERT INTO conversations (id, recipient_id, recipient_name, recipient_avatar_color, recipient_status, unread_count) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET recipient_name = excluded.recipient_name, recipient_avatar_color = excluded.recipient_avatar_color, recipient_status = excluded.recipient_status, unread_count = excluded.unread_count`
  ).run(c.id, c.recipientId, c.recipientName, c.recipientAvatarColor, c.recipientStatus, c.unreadCount)
}

export function updateConversationUnread(id: string, unreadCount: number): void {
  getDb().prepare('UPDATE conversations SET unread_count = ? WHERE id = ?').run(unreadCount, id)
}

export function deleteConversationWith(recipientId: string): void {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM conversations WHERE recipient_id = ?').all(recipientId) as Array<{ id: string }>
  for (const r of rows) {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(r.id)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(r.id)
  }
}

// ── Messages ──

const MSG_COLS = 'id, conversation_id AS conversationId, sender_id AS senderId, sender_name AS senderName, content, timestamp, status, file_id AS fileId, file_name AS fileName, file_size AS fileSize, file_type AS fileType, file_path AS filePath, edited_at AS editedAt, is_deleted AS isDeleted, reactions'

export function getMessages(conversationId: string, limit = 50, before?: number): MessageRow[] {
  if (before) {
    return getDb().prepare(`SELECT ${MSG_COLS} FROM messages WHERE conversation_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`).all(conversationId, before, limit) as MessageRow[]
  }
  return getDb().prepare(`SELECT ${MSG_COLS} FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?`).all(conversationId, limit) as MessageRow[]
}

export function insertMessage(msg: MessageRow): void {
  getDb().prepare('INSERT OR REPLACE INTO messages (id, conversation_id, sender_id, sender_name, content, timestamp, status, file_id, file_name, file_size, file_type, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(msg.id, msg.conversationId, msg.senderId, msg.senderName, msg.content, msg.timestamp, msg.status, msg.fileId, msg.fileName, msg.fileSize, msg.fileType, msg.filePath)
}

export function updateMessageStatus(id: string, status: string): void {
  getDb().prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id)
}

export function editMessage(id: string, content: string, editedAt: number): void {
  getDb().prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(content, editedAt, id)
}

export function deleteMessage(id: string): void {
  getDb().prepare('UPDATE messages SET is_deleted = 1, content = \'\' WHERE id = ?').run(id)
}

export function getMessage(id: string): MessageRow | null {
  const row = getDb().prepare(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`).get(id) as MessageRow | undefined
  return row ?? null
}

function mutateReactions(
  existingJson: string,
  emojiId: string,
  userId: string,
  add: boolean
): string {
  let parsed: Record<string, string[]>
  try {
    parsed = JSON.parse(existingJson || '{}')
  } catch {
    parsed = {}
  }
  const list = parsed[emojiId] ?? []
  const has = list.includes(userId)
  if (add && !has) parsed[emojiId] = [...list, userId]
  else if (!add && has) {
    const next = list.filter((u) => u !== userId)
    if (next.length === 0) delete parsed[emojiId]
    else parsed[emojiId] = next
  }
  return JSON.stringify(parsed)
}

/** Toggle a reaction on a DM message. Returns the updated reactions JSON string. */
export function setMessageReaction(messageId: string, emojiId: string, userId: string, add: boolean): string {
  const d = getDb()
  const row = d.prepare('SELECT reactions FROM messages WHERE id = ?').get(messageId) as { reactions: string } | undefined
  const current = row?.reactions || '{}'
  const next = mutateReactions(current, emojiId, userId, add)
  d.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(next, messageId)
  return next
}

export function setServerMessageReaction(messageId: string, emojiId: string, userId: string, add: boolean): string {
  const d = getDb()
  const row = d.prepare('SELECT reactions FROM server_messages WHERE id = ?').get(messageId) as { reactions: string } | undefined
  const current = row?.reactions || '{}'
  const next = mutateReactions(current, emojiId, userId, add)
  d.prepare('UPDATE server_messages SET reactions = ? WHERE id = ?').run(next, messageId)
  return next
}

/** Replace reactions blob wholesale (used when applying a remote authoritative state). */
export function replaceMessageReactions(messageId: string, reactionsJson: string): void {
  getDb().prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(reactionsJson, messageId)
}
export function replaceServerMessageReactions(messageId: string, reactionsJson: string): void {
  getDb().prepare('UPDATE server_messages SET reactions = ? WHERE id = ?').run(reactionsJson, messageId)
}

// ── Servers ──

const SRV_COLS = 'id, name, icon_color AS iconColor, role, text_channel_name AS textChannelName, voice_room_name AS voiceRoomName, member_count AS memberCount, online_member_count AS onlineMemberCount, host_user_id AS hostUserId, host_username AS hostUsername, host_avatar_color AS hostAvatarColor, banned, password_hash AS passwordHash'

export function getServers(): ServerRow[] {
  return getDb().prepare(`SELECT ${SRV_COLS} FROM servers`).all() as ServerRow[]
}

export function getServer(serverId: string): ServerRow | null {
  const row = getDb().prepare(`SELECT ${SRV_COLS} FROM servers WHERE id = ?`).get(serverId) as ServerRow | undefined
  return row ?? null
}

export function addServer(s: ServerRow): void {
  getDb().prepare(
    'INSERT OR REPLACE INTO servers (id, name, icon_color, role, text_channel_name, voice_room_name, member_count, online_member_count, host_user_id, host_username, host_avatar_color, banned, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(s.id, s.name, s.iconColor, s.role, s.textChannelName, s.voiceRoomName, s.memberCount, s.onlineMemberCount, s.hostUserId, s.hostUsername, s.hostAvatarColor, s.banned, s.passwordHash ?? null)
}

export function updateServerBanned(serverId: string, bannedJson: string): void {
  getDb().prepare('UPDATE servers SET banned = ? WHERE id = ?').run(bannedJson, serverId)
}

export function updateServerCounts(serverId: string, memberCount: number, onlineMemberCount: number): void {
  getDb().prepare('UPDATE servers SET member_count = ?, online_member_count = ? WHERE id = ?').run(memberCount, onlineMemberCount, serverId)
}

export function removeServer(serverId: string): void {
  const d = getDb()
  d.prepare('DELETE FROM server_messages WHERE server_id = ?').run(serverId)
  d.prepare('DELETE FROM server_members WHERE server_id = ?').run(serverId)
  d.prepare('DELETE FROM server_channels WHERE server_id = ?').run(serverId)
  d.prepare('DELETE FROM server_categories WHERE server_id = ?').run(serverId)
  d.prepare('DELETE FROM servers WHERE id = ?').run(serverId)
}

// ── Server Categories / Channels ──

const CAT_COLS = 'id, server_id AS serverId, name, position'
const CHAN_COLS = 'id, server_id AS serverId, category_id AS categoryId, name, type, position'

export function getServerCategories(serverId: string): ServerCategoryRow[] {
  return getDb().prepare(`SELECT ${CAT_COLS} FROM server_categories WHERE server_id = ? ORDER BY position ASC`).all(serverId) as ServerCategoryRow[]
}

export function getServerChannels(serverId: string): ServerChannelRow[] {
  return getDb().prepare(`SELECT ${CHAN_COLS} FROM server_channels WHERE server_id = ? ORDER BY position ASC`).all(serverId) as ServerChannelRow[]
}

export function insertServerCategory(row: ServerCategoryRow): void {
  getDb().prepare('INSERT OR REPLACE INTO server_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)').run(row.id, row.serverId, row.name, row.position)
}

export function updateServerCategoryName(id: string, name: string): void {
  getDb().prepare('UPDATE server_categories SET name = ? WHERE id = ?').run(name, id)
}

export function deleteServerCategory(id: string): void {
  const d = getDb()
  // Orphan the child channels so they survive into the "uncategorized" bucket.
  d.prepare('UPDATE server_channels SET category_id = NULL WHERE category_id = ?').run(id)
  d.prepare('DELETE FROM server_categories WHERE id = ?').run(id)
}

export function insertServerChannel(row: ServerChannelRow): void {
  getDb().prepare('INSERT OR REPLACE INTO server_channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.serverId, row.categoryId, row.name, row.type, row.position)
}

export function updateServerChannelName(id: string, name: string): void {
  getDb().prepare('UPDATE server_channels SET name = ? WHERE id = ?').run(name, id)
}

export function deleteServerChannel(id: string): void {
  const d = getDb()
  d.prepare('DELETE FROM server_messages WHERE channel_id = ?').run(id)
  d.prepare('DELETE FROM server_channels WHERE id = ?').run(id)
}

export function getServerChannel(id: string): ServerChannelRow | null {
  const row = getDb().prepare(`SELECT ${CHAN_COLS} FROM server_channels WHERE id = ?`).get(id) as ServerChannelRow | undefined
  return row ?? null
}

/**
 * One-time migration: for every server that has no categories/channels yet,
 * seed a "Text Channels" category with `text_channel_name`, and a
 * "Voice Channels" category with `voice_room_name`. Also backfills the
 * `channel_id` on legacy server_messages rows so message history keeps
 * rendering after the UI switches to per-channel history.
 */
export function seedDefaultServerChannelsIfMissing(): void {
  const d = getDb()
  const servers = d.prepare('SELECT id, text_channel_name AS textChannelName, voice_room_name AS voiceRoomName FROM servers').all() as { id: string; textChannelName: string; voiceRoomName: string }[]
  for (const s of servers) {
    const existing = d.prepare('SELECT COUNT(*) AS c FROM server_channels WHERE server_id = ?').get(s.id) as { c: number }
    if (existing.c > 0) continue
    const textCatId = `${s.id}__cat-text`
    const voiceCatId = `${s.id}__cat-voice`
    const textChId = `${s.id}__ch-text-default`
    const voiceChId = `${s.id}__ch-voice-default`
    insertServerCategory({ id: textCatId, serverId: s.id, name: 'Text Channels', position: 0 })
    insertServerCategory({ id: voiceCatId, serverId: s.id, name: 'Voice Channels', position: 1 })
    insertServerChannel({ id: textChId, serverId: s.id, categoryId: textCatId, name: s.textChannelName || 'general', type: 'text', position: 0 })
    insertServerChannel({ id: voiceChId, serverId: s.id, categoryId: voiceCatId, name: s.voiceRoomName || 'Voice Lounge', type: 'voice', position: 0 })
    // Backfill legacy messages onto the default text channel.
    d.prepare('UPDATE server_messages SET channel_id = ? WHERE server_id = ? AND channel_id IS NULL').run(textChId, s.id)
  }
}

// ── Server Members ──

export function getServerMembers(serverId: string): ServerMemberRow[] {
  return getDb().prepare('SELECT server_id AS serverId, user_id AS userId, username, avatar_color AS avatarColor, role, status, is_muted AS isMuted FROM server_members WHERE server_id = ?').all(serverId) as ServerMemberRow[]
}

export function addServerMember(m: ServerMemberRow): void {
  getDb().prepare('INSERT OR REPLACE INTO server_members (server_id, user_id, username, avatar_color, role, status, is_muted) VALUES (?, ?, ?, ?, ?, ?, ?)').run(m.serverId, m.userId, m.username, m.avatarColor, m.role, m.status, m.isMuted)
}

export function removeServerMember(serverId: string, userId: string): void {
  getDb().prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(serverId, userId)
}

export function updateServerMemberRole(serverId: string, userId: string, role: string): void {
  getDb().prepare('UPDATE server_members SET role = ? WHERE server_id = ? AND user_id = ?').run(role, serverId, userId)
}

export function updateServerMemberMuted(serverId: string, userId: string, isMuted: number): void {
  getDb().prepare('UPDATE server_members SET is_muted = ? WHERE server_id = ? AND user_id = ?').run(isMuted, serverId, userId)
}

export function updateServerMemberStatus(serverId: string, userId: string, status: string): void {
  getDb().prepare('UPDATE server_members SET status = ? WHERE server_id = ? AND user_id = ?').run(status, serverId, userId)
}

// ── Server Messages ──

const SMSG_COLS = 'id, server_id AS serverId, sender_id AS senderId, sender_name AS senderName, content, timestamp, status, file_id AS fileId, file_name AS fileName, file_size AS fileSize, file_type AS fileType, file_path AS filePath, edited_at AS editedAt, is_deleted AS isDeleted, reactions, channel_id AS channelId'

export function getServerMessages(serverId: string, limit = 50, before?: number): ServerMessageRow[] {
  if (before) {
    return getDb().prepare(`SELECT ${SMSG_COLS} FROM server_messages WHERE server_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`).all(serverId, before, limit) as ServerMessageRow[]
  }
  return getDb().prepare(`SELECT ${SMSG_COLS} FROM server_messages WHERE server_id = ? ORDER BY timestamp DESC LIMIT ?`).all(serverId, limit) as ServerMessageRow[]
}

export function insertServerMessage(msg: ServerMessageRow): void {
  getDb().prepare('INSERT OR REPLACE INTO server_messages (id, server_id, sender_id, sender_name, content, timestamp, status, file_id, file_name, file_size, file_type, file_path, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(msg.id, msg.serverId, msg.senderId, msg.senderName, msg.content, msg.timestamp, msg.status, msg.fileId, msg.fileName, msg.fileSize, msg.fileType, msg.filePath, msg.channelId ?? null)
}

export function getServerMessagesByChannel(serverId: string, channelId: string, limit = 50, before?: number): ServerMessageRow[] {
  const d = getDb()
  if (before) {
    return d.prepare(`SELECT ${SMSG_COLS} FROM server_messages WHERE server_id = ? AND channel_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`).all(serverId, channelId, before, limit) as ServerMessageRow[]
  }
  return d.prepare(`SELECT ${SMSG_COLS} FROM server_messages WHERE server_id = ? AND channel_id = ? ORDER BY timestamp DESC LIMIT ?`).all(serverId, channelId, limit) as ServerMessageRow[]
}

export function updateMessageFilePath(messageId: string, filePath: string): void {
  getDb().prepare('UPDATE messages SET file_path = ? WHERE id = ?').run(filePath, messageId)
}

export function updateServerMessageFilePath(messageId: string, filePath: string): void {
  getDb().prepare('UPDATE server_messages SET file_path = ? WHERE id = ?').run(filePath, messageId)
}

export function editServerMessage(id: string, content: string, editedAt: number): void {
  getDb().prepare('UPDATE server_messages SET content = ?, edited_at = ? WHERE id = ?').run(content, editedAt, id)
}

export function deleteServerMessage(id: string): void {
  getDb().prepare('UPDATE server_messages SET is_deleted = 1, content = \'\' WHERE id = ?').run(id)
}

// ── Blocked Users ──

export function getBlockedUsers(): BlockedUserRow[] {
  return getDb().prepare('SELECT user_id AS userId, username, blocked_at AS blockedAt FROM blocked_users').all() as BlockedUserRow[]
}

export function blockUser(userId: string, username: string): void {
  getDb().prepare('INSERT OR REPLACE INTO blocked_users (user_id, username, blocked_at) VALUES (?, ?, ?)').run(userId, username, Date.now())
}

export function unblockUser(userId: string): void {
  getDb().prepare('DELETE FROM blocked_users WHERE user_id = ?').run(userId)
}

// ── Relays ──

export function getRelays(): RelayRow[] {
  return getDb().prepare('SELECT id, address, scope, latency, users, is_custom AS isCustom FROM relays').all() as RelayRow[]
}

export function addRelay(r: RelayRow): void {
  getDb().prepare('INSERT OR REPLACE INTO relays (id, address, scope, latency, users, is_custom) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, r.address, r.scope, r.latency, r.users, r.isCustom)
}

export function removeRelay(id: string): void {
  getDb().prepare('DELETE FROM relays WHERE id = ?').run(id)
}

// ── Settings ──

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}
