import { create } from 'zustand'
import type { Server, ServerMember, ServerRoleDef } from '@/types/server'
import type { Message, FileAttachment } from '@/types/messages'
import { useIdentityStore } from './identity.store'
import { useAvatarStore } from './avatar.store'
import { useChannelsStore } from './channels.store'
import { PERM, effectivePermissions, hasPerm, resolveChannelPerm } from '../../../shared/permissions'
import { normalizeReactions } from './messages.store'
import { notify } from '@/lib/notify'
import { playServerMessage } from '@/lib/sounds'

interface ServersStore {
  servers: Server[]
  serverMembers: Record<string, ServerMember[]>
  serverMessages: Record<string, Message[]>
  serverVoiceStates: Record<string, Record<string, string>> // serverId -> { userId: channelId }
  /**
   * LIVE presence per server: userIds with an active signaling socket right
   * now. The DB member rows are a roster — their persisted `status` says
   * whatever was true when written (always 'online' at join) and must never
   * drive presence dots.
   */
  serverOnlineMembers: Record<string, string[]>
  /** Custom role definitions per server (host-authored, synced to members). */
  serverRoles: Record<string, ServerRoleDef[]>
  pendingJoin: string | null
  lastError: string | null

  initialize: () => Promise<void>
  reloadFromDb: () => Promise<void>
  createServer: (args: {
    name: string
    iconColor?: string
    textChannelName?: string
    voiceRoomName?: string
    passwordHash?: string | null
  }) => Promise<{ success: boolean; error?: string; serverId?: string }>
  joinServer: (serverId: string, passwordHash?: string | null) => Promise<{ success: boolean; error?: string }>
  leaveServer: (serverId: string, destroy?: boolean) => Promise<void>
  sendServerMessage: (serverId: string, content: string, channelId?: string | null) => Promise<void>
  sendServerFileMessage: (serverId: string, filePath: string, channelId?: string | null) => Promise<void>
  muteMember: (serverId: string, targetId: string, mute: boolean) => Promise<void>
  kickMember: (serverId: string, targetId: string) => Promise<void>
  banMember: (serverId: string, targetId: string) => Promise<void>
  setMemberRole: (serverId: string, targetId: string, role: 'moderator' | 'member') => Promise<void>
  /** Host-only: rename the role tiers for a server (display names only). */
  setRoleNames: (serverId: string, roleNames: { host: string; moderator: string; member: string } | null) => Promise<void>
  // Custom roles (Discord-style)
  createRole: (serverId: string, name: string, color: string, permissions: number) => Promise<void>
  updateRole: (serverId: string, roleId: string, name: string, color: string, permissions: number) => Promise<void>
  deleteRole: (serverId: string, roleId: string) => Promise<void>
  assignMemberRoles: (serverId: string, targetId: string, roleIds: string[]) => Promise<void>
  /** Effective permission mask for the current user in a server. */
  selfPermissions: (serverId: string) => number
  editServerMessage: (serverId: string, messageId: string, newContent: string) => Promise<void>
  deleteServerMessage: (serverId: string, messageId: string) => Promise<void>
  toggleServerReaction: (serverId: string, messageId: string, emojiId: string) => Promise<void>
  applyRemoteServerReaction: (serverId: string, messageId: string, emojiId: string, userId: string, add: boolean) => void
  // Full-replace variant for authoritative server-reaction snapshots.
  applyRemoteServerReactionFull: (serverId: string, messageId: string, reactions: Record<string, string[]>) => void
  subscribeToServerEvents: () => () => void
  reregisterOnReconnect: () => Promise<void>
}

function toServer(r: {
  id: string; name: string; iconColor: string; role: string; textChannelName: string;
  voiceRoomName: string; memberCount: number; onlineMemberCount: number; roleNames?: string | null
}): Server {
  let roleNames: Server['roleNames'] = null
  if (r.roleNames) {
    try {
      const parsed = JSON.parse(r.roleNames)
      if (parsed && typeof parsed === 'object') {
        roleNames = {
          host: typeof parsed.host === 'string' ? parsed.host : 'Host',
          moderator: typeof parsed.moderator === 'string' ? parsed.moderator : 'Moderator',
          member: typeof parsed.member === 'string' ? parsed.member : 'Member'
        }
      }
    } catch { /* corrupted JSON → defaults */ }
  }
  return {
    id: r.id,
    name: r.name,
    iconColor: r.iconColor,
    role: r.role as Server['role'],
    textChannelName: r.textChannelName,
    voiceRoomName: r.voiceRoomName,
    memberCount: r.memberCount,
    onlineMemberCount: r.onlineMemberCount,
    roleNames
  }
}

export const useServersStore = create<ServersStore>((set, get) => ({
  servers: [],
  serverMembers: {},
  serverMessages: {},
  serverVoiceStates: {},
  serverOnlineMembers: {},
  serverRoles: {},
  pendingJoin: null,
  lastError: null,

  initialize: async () => {
    await get().reloadFromDb()
  },

  reloadFromDb: async () => {
    const rows = await window.api.db.servers.list()
    const servers: Server[] = rows.map(toServer)
    const serverMembers: Record<string, ServerMember[]> = {}
    const serverMessages: Record<string, Message[]> = {}
    const serverRoles: Record<string, ServerRoleDef[]> = {}
    for (const srv of servers) {
      const roleRows = await window.api.server.listRoles({ serverId: srv.id }).catch(() => [])
      serverRoles[srv.id] = roleRows.map((r) => ({
        id: r.id,
        serverId: r.serverId,
        name: r.name,
        color: r.color,
        position: r.position,
        permissions: r.permissions ?? 0
      }))
      const memberRows = await window.api.db.serverMembers.list(srv.id)
      serverMembers[srv.id] = memberRows.map((m) => {
        let roleIds: string[] = []
        try {
          const parsed = JSON.parse(m.roleIds || '[]')
          if (Array.isArray(parsed)) roleIds = parsed
        } catch { /* default */ }
        return {
          userId: m.userId,
          username: m.username,
          avatarColor: m.avatarColor,
          role: m.role as ServerMember['role'],
          status: m.status as ServerMember['status'],
          isMuted: m.isMuted === 1,
          roleIds
        }
      })
      const msgRows = await window.api.db.serverMessages.list({ serverId: srv.id, limit: 50 })
      // Parse the reactions JSON column; without this a `"{}"` string leaks
      // into the store and renders as ghost "0"/"1" reaction chips.
      // Also rebuild the `file` object from the flat DB columns — without
      // this, file attachments vanished from history after every restart.
      serverMessages[srv.id] = msgRows.reverse().map((m) => {
        // Row → Message: server rows have no conversationId (serverId plays
        // that role downstream), hence the unknown hop.
        const msg = m as unknown as Message & { fileId?: string | null; fileName?: string | null; fileSize?: number | null; fileType?: string | null; filePath?: string | null }
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
    }
    set({ servers, serverMembers, serverMessages, serverRoles })
  },

  createServer: async ({ name, iconColor, textChannelName, voiceRoomName, passwordHash }) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return { success: false, error: 'No identity' }
    const res = await window.api.server.create({
      name,
      iconColor: iconColor ?? '#107C10',
      textChannelName: textChannelName ?? 'general',
      voiceRoomName: voiceRoomName ?? 'Voice Lounge',
      hostUserId: identity.userId,
      hostUsername: identity.username,
      hostAvatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null,
      passwordHash
    })
    if (res.success) await get().reloadFromDb()
    else set({ lastError: res.error ?? null })
    return res
  },

  joinServer: async (serverId, passwordHash) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return { success: false, error: 'No identity' }
    set({ pendingJoin: serverId, lastError: null })
    const res = await window.api.server.join({
      serverId,
      userId: identity.userId,
      username: identity.username,
      avatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null,
      passwordHash
    })
    if (!res.success) {
      // Send failed at the IPC layer — clear the pending state immediately
      // so the UI doesn't sit on a spinner.
      set({ pendingJoin: null, lastError: res.error ?? 'Failed to join server' })
      return res
    }
    // Safety timeout: if join-ack / join-denied / server:error never arrives
    // (signaling dropped mid-flight, host offline), clear the pending state
    // after 15s so the user sees an actionable error instead of an endless spinner.
    setTimeout(() => {
      const state = get()
      if (state.pendingJoin === serverId && !state.servers.find((s) => s.id === serverId)) {
        set({ pendingJoin: null, lastError: 'Join timed out. The server may be offline or unreachable.' })
      }
    }, 15000)
    return res
  },

  leaveServer: async (serverId, destroy) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.server.leave({ serverId, userId: identity.userId, destroy })
    await window.api.server.removeLocal(serverId)
    set((s) => {
      const { [serverId]: _m, ...restMembers } = s.serverMembers
      const { [serverId]: _x, ...restMsgs } = s.serverMessages
      return {
        servers: s.servers.filter((sv) => sv.id !== serverId),
        serverMembers: restMembers,
        serverMessages: restMsgs
      }
    })
  },

  sendServerMessage: async (serverId, content, channelId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const res = await window.api.server.sendMessage({
      serverId,
      senderId: identity.userId,
      senderName: identity.username,
      content,
      channelId: channelId ?? null
    })
    if (res.success && res.messageId) {
      const msg: Message = {
        id: res.messageId,
        conversationId: serverId,
        senderId: identity.userId,
        senderName: identity.username,
        content,
        timestamp: Date.now(),
        status: 'sent',
        channelId: channelId ?? null
      }
      set((s) => {
        const existing = s.serverMessages[serverId] || []
        if (existing.some((m) => m.id === msg.id)) return {}
        return { serverMessages: { ...s.serverMessages, [serverId]: [...existing, msg] } }
      })
    } else if (res.error) {
      set({ lastError: res.error })
    }
  },

  sendServerFileMessage: async (serverId, filePath, channelId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return

    const fileData = await window.api.file.read(filePath)
    if (!fileData) return

    // Server attachments are relayed through the signaling host as base64
    // (no per-member P2P fan-out yet), so cap the size at 2MB — the host's
    // socket accepts up to 8MB frames, leaving comfortable headroom.
    const MAX_SERVER_FILE = 2 * 1024 * 1024
    if (fileData.fileSize > MAX_SERVER_FILE) {
      set({ lastError: 'Files up to 2 MB can be shared in servers for now.' })
      return
    }

    const file: FileAttachment = {
      fileId: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fileName: fileData.fileName,
      fileSize: fileData.fileSize,
      fileType: fileData.fileType,
      filePath,
      base64: fileData.fileType.startsWith('image/') ? fileData.base64 : undefined
    }

    const res = await window.api.server.sendMessage({
      serverId,
      senderId: identity.userId,
      senderName: identity.username,
      content: `[File: ${file.fileName}]`,
      channelId: channelId ?? null,
      file: {
        fileId: file.fileId,
        fileName: file.fileName,
        fileSize: file.fileSize,
        fileType: file.fileType,
        base64: fileData.base64,
        filePath
      }
    })
    if (res.success && res.messageId) {
      const msg: Message = {
        id: res.messageId,
        conversationId: serverId,
        senderId: identity.userId,
        senderName: identity.username,
        content: `[File: ${file.fileName}]`,
        timestamp: Date.now(),
        status: 'sent',
        channelId: channelId ?? null,
        file
      }
      set((s) => {
        const existing = s.serverMessages[serverId] || []
        if (existing.some((m) => m.id === msg.id)) return {}
        return { serverMessages: { ...s.serverMessages, [serverId]: [...existing, msg] } }
      })
    } else if (res.error) {
      set({ lastError: res.error })
    }
  },

  muteMember: async (serverId, targetId, mute) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.server.mute({ serverId, actorId: identity.userId, targetId, mute })
  },

  kickMember: async (serverId, targetId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.server.kick({ serverId, actorId: identity.userId, targetId })
  },

  banMember: async (serverId, targetId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.server.ban({ serverId, actorId: identity.userId, targetId })
  },

  setMemberRole: async (serverId, targetId, role) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.server.setRole({ serverId, actorId: identity.userId, targetId, role })
  },

  setRoleNames: async (serverId, roleNames) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const res = await window.api.server.setRoleNames({ serverId, actorId: identity.userId, roleNames })
    if (res.success) await get().reloadFromDb()
    else set({ lastError: res.error ?? 'Failed to update role names' })
  },

  createRole: async (serverId, name, color, permissions) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const res = await window.api.server.createRole({ serverId, actorId: identity.userId, name, color, permissions })
    if (res.success) await get().reloadFromDb()
    else set({ lastError: res.error ?? 'Failed to create role' })
  },

  updateRole: async (serverId, roleId, name, color, permissions) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const res = await window.api.server.updateRole({ serverId, actorId: identity.userId, roleId, name, color, permissions })
    if (res.success) await get().reloadFromDb()
    else set({ lastError: res.error ?? 'Failed to update role' })
  },

  selfPermissions: (serverId) => {
    const selfId = useIdentityStore.getState().identity?.userId
    if (!selfId) return 0
    const me = (get().serverMembers[serverId] || []).find((m) => m.userId === selfId)
    if (!me) return 0
    return effectivePermissions(me.role, me.roleIds, get().serverRoles[serverId] ?? [])
  },

  deleteRole: async (serverId, roleId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const res = await window.api.server.deleteRole({ serverId, actorId: identity.userId, roleId })
    if (res.success) await get().reloadFromDb()
    else set({ lastError: res.error ?? 'Failed to delete role' })
  },

  assignMemberRoles: async (serverId, targetId, roleIds) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const res = await window.api.server.assignMemberRoles({ serverId, actorId: identity.userId, targetId, roleIds })
    if (res.success) await get().reloadFromDb()
    else set({ lastError: res.error ?? 'Failed to assign roles' })
  },

  editServerMessage: async (serverId, messageId, newContent) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const existing = (get().serverMessages[serverId] || []).find((m) => m.id === messageId)
    if (!existing || existing.senderId !== identity.userId) return // sender-only
    const res = await window.api.server.editMessage({
      serverId,
      messageId,
      senderId: identity.userId,
      content: newContent
    })
    if (res.success && res.editedAt) {
      set((s) => ({
        serverMessages: {
          ...s.serverMessages,
          [serverId]: (s.serverMessages[serverId] || []).map((m) =>
            m.id === messageId ? { ...m, content: newContent, editedAt: res.editedAt ?? Date.now() } : m
          )
        }
      }))
    }
  },

  deleteServerMessage: async (serverId, messageId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const existing = (get().serverMessages[serverId] || []).find((m) => m.id === messageId)
    const members = get().serverMembers[serverId] || []
    const selfMember = members.find((m) => m.userId === identity.userId)
    if (!existing) return
    const canDelete =
      existing.senderId === identity.userId ||
      selfMember?.role === 'host' ||
      selfMember?.role === 'moderator' ||
      hasPerm(get().selfPermissions(serverId), PERM.manageMessages)
    if (!canDelete) return
    await window.api.server.deleteMessage({ serverId, messageId, actorId: identity.userId })
    set((s) => ({
      serverMessages: {
        ...s.serverMessages,
        [serverId]: (s.serverMessages[serverId] || []).map((m) =>
          m.id === messageId ? { ...m, content: '', isDeleted: true, file: null } : m
        )
      }
    }))
  },

  toggleServerReaction: async (serverId, messageId, emojiId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    // Channel-aware permission: overrides can grant or revoke reactions
    // for this specific channel; fall back to the server-level bit.
    const targetMsg = (get().serverMessages[serverId] || []).find((m) => m.id === messageId)
    const chDef = targetMsg?.channelId
      ? useChannelsStore.getState().byServer[serverId]?.channels.find((c) => c.id === targetMsg.channelId)
      : undefined
    if (chDef) {
      const me = (get().serverMembers[serverId] || []).find((m) => m.userId === identity.userId)
      const allowed = resolveChannelPerm({
        tier: me?.role ?? 'member',
        roleIds: me?.roleIds ?? [],
        roles: get().serverRoles[serverId] ?? [],
        overrides: chDef.overrides,
        minRole: chDef.minRole,
        allowedRoleIds: chDef.allowedRoleIds,
        key: 'addReactions'
      })
      if (!allowed) return
    } else if (!hasPerm(get().selfPermissions(serverId), PERM.addReactions)) {
      return
    }

    const msgs = get().serverMessages[serverId]
    if (!msgs) return
    const msg = msgs.find((m) => m.id === messageId)
    if (!msg) return

    const myReacts = msg.reactions?.[emojiId] || []
    const selfId = identity.userId
    const alreadyReacted = myReacts.includes(selfId)
    const add = !alreadyReacted

    // Optimistically update
    get().applyRemoteServerReaction(serverId, messageId, emojiId, selfId, add)

    // Re-read post-update so we broadcast the FULL authoritative reactions
    // map for this message. Receivers replace their local map wholesale,
    // preventing divergence when several users react in the same instant.
    const updated = get().serverMessages[serverId]?.find((m) => m.id === messageId)
    const reactions = updated?.reactions ? { ...updated.reactions } : {}

    // Notify others in server — delta fields stay for DB persistence, `reactions`
    // is the authoritative snapshot.
    window.api.signaling.emit('server:message-reaction', {
      serverId,
      messageId,
      emojiId,
      userId: selfId,
      add,
      reactions
    })

    await window.api.reaction.toggleServer({
      serverId,
      messageId,
      emojiId,
      userId: selfId,
      add
    })
  },

  applyRemoteServerReactionFull: (serverId, messageId, reactions) => {
    set((s) => {
      const msgs = s.serverMessages[serverId]
      if (!msgs) return {}
      if (!msgs.some((m) => m.id === messageId)) return {}
      const newMsgs = msgs.map((m) =>
        m.id === messageId ? { ...m, reactions: { ...reactions } } : m
      )
      return { serverMessages: { ...s.serverMessages, [serverId]: newMsgs } }
    })
  },

  applyRemoteServerReaction: (serverId, messageId, emojiId, userId, add) => {
    set((s) => {
      const msgs = s.serverMessages[serverId]
      if (!msgs) return {}
      const hasMsg = msgs.some((m) => m.id === messageId)
      if (!hasMsg) return {}
      
      const newMsgs = msgs.map((m) => {
        if (m.id !== messageId) return m
        const existingMap = m.reactions || {}
        const existingList = existingMap[emojiId] || []
        let newList = [...existingList]
        if (add && !newList.includes(userId)) newList.push(userId)
        else if (!add && newList.includes(userId)) newList = newList.filter((id) => id !== userId)

        const newMap = { ...existingMap, [emojiId]: newList }
        if (newMap[emojiId].length === 0) delete newMap[emojiId]
        return { ...m, reactions: newMap }
      })

      return { serverMessages: { ...s.serverMessages, [serverId]: newMsgs } }
    })
  },

  subscribeToServerEvents: () => {
    const unsubs: Array<() => void> = []

    unsubs.push(window.api.signaling.onServerEvent('join-ack', async (payload) => {
      console.log('[servers.store] join-ack received:', payload)
      if (!payload || typeof payload !== 'object') {
        console.error('[servers.store] Invalid join-ack payload:', payload)
        set({ pendingJoin: null, lastError: 'Invalid server response from signaling' })
        return
      }

      // Normalise shape: the signaling server emits a FLAT payload
      //   { serverId, name, iconColor, textChannelName, voiceRoomName,
      //     hostUserId, hostUsername, hostAvatarColor, members, yourRole }
      // but our main-process persistor expects the nested shape
      //   { server: { id, name, ... }, members, yourRole }
      // Previously the flat form failed the `'server' in payload` check and
      // the invitee's join silently timed out — while the host's signaling
      // server already showed them as joined. Accept both shapes.
      type FlatJoinAck = {
        serverId: string
        name: string
        iconColor: string
        textChannelName: string
        voiceRoomName: string
        hostUserId: string
        hostUsername: string
        hostAvatarColor: string | null
        members: Array<{ userId: string; username: string; avatarColor: string | null; role: string; isMuted: boolean }>
        onlineUserIds?: string[]
        layout?: unknown | null
        roleNames?: { host?: string; moderator?: string; member?: string } | null
        yourRole: string
      }
      type NestedJoinAck = {
        server: {
          id: string
          name: string
          iconColor: string
          textChannelName: string
          voiceRoomName: string
          hostUserId: string
          hostUsername: string
          hostAvatarColor: string | null
          roleNames?: { host?: string; moderator?: string; member?: string } | null
        }
        members: Array<{ userId: string; username: string; avatarColor: string | null; role: string; isMuted: boolean }>
        yourRole: string
      }
      const raw = payload as Partial<FlatJoinAck & NestedJoinAck>
      const nested: NestedJoinAck | null = raw.server
        ? (raw as NestedJoinAck)
        : raw.serverId
          ? {
              server: {
                id: raw.serverId!,
                name: raw.name!,
                iconColor: raw.iconColor!,
                textChannelName: raw.textChannelName!,
                voiceRoomName: raw.voiceRoomName!,
                hostUserId: raw.hostUserId!,
                hostUsername: raw.hostUsername!,
                hostAvatarColor: raw.hostAvatarColor ?? null,
                roleNames: raw.roleNames ?? null
              },
              members: raw.members ?? [],
              yourRole: raw.yourRole ?? 'member'
            }
          : null

      if (!nested || !nested.server?.id) {
        console.error('[servers.store] Invalid join-ack payload:', payload)
        set({ pendingJoin: null, lastError: 'Invalid server response from signaling' })
        return
      }

      try {
        // Include the host's custom role definitions so the persist step can
        // adopt them alongside the roster.
        await window.api.server.joinAckPersist({
          ...nested,
          roles: (raw as { roles?: unknown[] }).roles
        })
        // Adopt the host's channel layout (incl. role gates) before reload so
        // the tree renders the authoritative structure, not our stale copy.
        const layout = (raw as { layout?: unknown }).layout
        if (layout) {
          await window.api.server.applyLayout({ serverId: nested.server.id, layout }).catch(() => {})
          await useChannelsStore.getState().reload(nested.server.id).catch(() => {})
        }
        await get().reloadFromDb()
        // Live presence for this server, computed by the signaling server
        // from actual sockets. Always include self — we're clearly online.
        const selfIdNow = useIdentityStore.getState().identity?.userId
        const online = new Set((raw as { onlineUserIds?: string[] }).onlineUserIds ?? [])
        if (selfIdNow) online.add(selfIdNow)
        set((s) => ({
          pendingJoin: null,
          serverOnlineMembers: { ...s.serverOnlineMembers, [nested.server.id]: [...online] }
        }))
        // Broadcast our avatar to every existing server member so they see
        // our real picture immediately. Uses P2P when available, otherwise
        // signaling-relayed DM — every member has a known userId either way.
        const memberIds = nested.members.map((m) => m.userId)
        useAvatarStore.getState().broadcastToUsers(memberIds).catch(() => {})
      } catch (err) {
        console.error('[servers.store] join-ack-persist failed:', err)
        set({ pendingJoin: null, lastError: 'Failed to join server: ' + (err instanceof Error ? err.message : String(err)) })
      }
    }))

    unsubs.push(window.api.signaling.onServerEvent('join-denied', (payload) => {
      const p = payload as { serverId: string; reason: string }
      set({ pendingJoin: null, lastError: p.reason })
    }))

    unsubs.push(window.api.signaling.onServerEvent('member-joined', async (payload) => {
      await window.api.server.memberJoinedPersist(payload)
      await get().reloadFromDb()
      const p = payload as { serverId?: string; member?: { userId: string } }
      // A joining member has a live socket by definition — mark them online.
      if (p.serverId && p.member?.userId) {
        set((s) => {
          const cur = new Set(s.serverOnlineMembers[p.serverId!] ?? [])
          cur.add(p.member!.userId)
          return { serverOnlineMembers: { ...s.serverOnlineMembers, [p.serverId!]: [...cur] } }
        })
      }
      // Send our avatar to the newcomer so we're not just coloured initials
      // in their member list.
      if (p.member?.userId) {
        useAvatarStore.getState().sendToPeer(p.member.userId).catch(() => {})
      }
    }))

    const dropOnline = (serverId: string, userId: string): void => {
      set((s) => ({
        serverOnlineMembers: {
          ...s.serverOnlineMembers,
          [serverId]: (s.serverOnlineMembers[serverId] ?? []).filter((id) => id !== userId)
        }
      }))
    }

    unsubs.push(window.api.signaling.onServerEvent('member-left', (payload) => {
      const p = payload as { serverId: string; userId: string }
      dropOnline(p.serverId, p.userId)
      set((s) => ({
        serverMembers: {
          ...s.serverMembers,
          [p.serverId]: (s.serverMembers[p.serverId] || []).filter((m) => m.userId !== p.userId)
        }
      }))
    }))

    // The host's channel layout changed (or was re-broadcast on register) —
    // adopt it and refresh the tree. applyLayout refuses to touch servers we
    // host, so an echo can't clobber the authoritative copy.
    unsubs.push(window.api.signaling.onServerEvent('layout', async (payload) => {
      const p = payload as { serverId?: string; layout?: unknown }
      if (!p?.serverId || !p.layout) return
      const res = await window.api.server.applyLayout({ serverId: p.serverId, layout: p.layout }).catch(() => ({ success: false }))
      if (res.success) {
        await useChannelsStore.getState().reload(p.serverId).catch(() => {})
      }
    }))

    // The host renamed the role tiers — adopt and refresh.
    unsubs.push(window.api.signaling.onServerEvent('role-names', async (payload) => {
      const p = payload as { serverId?: string; roleNames?: { host?: string; moderator?: string; member?: string } | null }
      if (!p?.serverId) return
      const res = await window.api.server.applyRoleNames({ serverId: p.serverId, roleNames: p.roleNames ?? null }).catch(() => ({ success: false }))
      if (res.success) await get().reloadFromDb()
    }))

    // The host changed the custom role definitions — adopt and refresh.
    unsubs.push(window.api.signaling.onServerEvent('roles', async (payload) => {
      const p = payload as { serverId?: string; roles?: unknown }
      if (!p?.serverId || !Array.isArray(p.roles)) return
      const res = await window.api.server.applyRoles({ serverId: p.serverId, roles: p.roles }).catch(() => ({ success: false }))
      if (res.success) await get().reloadFromDb()
    }))

    // A member's custom role assignments changed.
    unsubs.push(window.api.signaling.onServerEvent('member-roles', async (payload) => {
      const p = payload as { serverId?: string; userId?: string; roleIds?: string[] }
      if (!p?.serverId || !p.userId) return
      await window.api.server.applyMemberRoles({
        serverId: p.serverId,
        userId: p.userId,
        roleIds: Array.isArray(p.roleIds) ? p.roleIds : []
      }).catch(() => {})
      set((s) => ({
        serverMembers: {
          ...s.serverMembers,
          [p.serverId!]: (s.serverMembers[p.serverId!] || []).map((m) =>
            m.userId === p.userId ? { ...m, roleIds: Array.isArray(p.roleIds) ? p.roleIds! : [] } : m
          )
        }
      }))
    }))

    // The signaling server refused our voice join (channel full). Roll back
    // the optimistic local join and tell the user why.
    unsubs.push(window.api.signaling.onServerEvent('voice-join-denied', async (payload) => {
      const p = payload as { serverId?: string; reason?: string }
      const { useVoiceStore } = await import('./voice.store')
      const vs = useVoiceStore.getState()
      if (vs.isConnected && vs.currentServerId === p.serverId) vs.leaveRoom()
      set({ lastError: p.reason ?? 'Voice channel is full.' })
      notify({
        type: 'server-kick',
        title: 'Could not join voice',
        body: p.reason ?? 'The voice channel is full.',
        route: p.serverId ? `/channels/${p.serverId}` : '/channels/@me',
        force: true
      })
    }))

    // Our own socket dropped — we can't see anyone's presence anymore.
    unsubs.push(window.api.signaling.onDisconnected(() => {
      set({ serverOnlineMembers: {} })
    }))

    unsubs.push(window.api.signaling.onServerEvent('message', async (payload) => {
      const p = payload as {
        serverId: string
        message: {
          id: string; senderId: string; senderName: string; content: string; timestamp: number; channelId?: string | null
          file?: { fileId: string; fileName: string; fileSize: number; fileType: string; base64?: string } | null
        }
      }
      // Dedupe BEFORE any work — the broadcast echoes back to the sender,
      // and for file messages we must not re-save the bytes we just sent.
      if ((get().serverMessages[p.serverId] || []).some((m) => m.id === p.message.id)) return

      // File attachment: save the relayed bytes to disk first so the message
      // is persisted with a real local path and renders after restart.
      let file: FileAttachment | undefined
      if (p.message.file) {
        const f = p.message.file
        let savedPath: string | null = null
        if (f.base64) {
          try {
            const saved = await window.api.file.saveReceived({ fileId: f.fileId, fileName: f.fileName, base64: f.base64 })
            savedPath = saved.filePath
          } catch (err) {
            console.error('[servers.store] failed to save received file:', err)
          }
        }
        file = {
          fileId: f.fileId,
          fileName: f.fileName,
          fileSize: f.fileSize,
          fileType: f.fileType,
          filePath: savedPath,
          base64: f.fileType.startsWith('image/') ? f.base64 : undefined
        }
        await window.api.server.messageRemote({
          serverId: p.serverId,
          message: { ...p.message, file: { fileId: f.fileId, fileName: f.fileName, fileSize: f.fileSize, fileType: f.fileType, filePath: savedPath } }
        })
      } else {
        await window.api.server.messageRemote(p)
      }
      let appended = false
      set((s) => {
        const existing = s.serverMessages[p.serverId] || []
        if (existing.some((m) => m.id === p.message.id)) return {}
        const msg: Message = {
          id: p.message.id,
          conversationId: p.serverId,
          senderId: p.message.senderId,
          senderName: p.message.senderName,
          content: p.message.content,
          timestamp: p.message.timestamp,
          status: 'delivered',
          channelId: p.message.channelId ?? null,
          file: file ?? null
        }
        appended = true
        return { serverMessages: { ...s.serverMessages, [p.serverId]: [...existing, msg] } }
      })
      // Soft ding for fresh server messages — suppress for self-sent and for
      // dedupe hits (messages we've already seen via echo/refresh).
      const selfId = useIdentityStore.getState().identity?.userId
      if (appended && p.message.senderId !== selfId) playServerMessage()
    }))

    unsubs.push(window.api.signaling.onServerEvent('member-muted', async (payload) => {
      const p = payload as { serverId: string; userId: string; mute: boolean }
      await window.api.server.applyModeration({ serverId: p.serverId, kind: 'mute', targetId: p.userId, mute: p.mute })
      set((s) => ({
        serverMembers: {
          ...s.serverMembers,
          [p.serverId]: (s.serverMembers[p.serverId] || []).map((m) =>
            m.userId === p.userId ? { ...m, isMuted: p.mute } : m
          )
        }
      }))
    }))

    unsubs.push(window.api.signaling.onServerEvent('member-kicked', async (payload) => {
      const p = payload as { serverId: string; userId: string }
      await window.api.server.applyModeration({ serverId: p.serverId, kind: 'kick', targetId: p.userId })
      dropOnline(p.serverId, p.userId)
      set((s) => ({
        serverMembers: {
          ...s.serverMembers,
          [p.serverId]: (s.serverMembers[p.serverId] || []).filter((m) => m.userId !== p.userId)
        }
      }))
    }))

    unsubs.push(window.api.signaling.onServerEvent('member-banned', async (payload) => {
      const p = payload as { serverId: string; userId: string }
      await window.api.server.applyModeration({ serverId: p.serverId, kind: 'ban', targetId: p.userId })
      dropOnline(p.serverId, p.userId)
      set((s) => ({
        serverMembers: {
          ...s.serverMembers,
          [p.serverId]: (s.serverMembers[p.serverId] || []).filter((m) => m.userId !== p.userId)
        }
      }))
    }))

    unsubs.push(window.api.signaling.onServerEvent('member-role-changed', async (payload) => {
      const p = payload as { serverId: string; userId: string; role: 'moderator' | 'member' }
      await window.api.server.applyModeration({ serverId: p.serverId, kind: 'role', targetId: p.userId, role: p.role })
      set((s) => ({
        serverMembers: {
          ...s.serverMembers,
          [p.serverId]: (s.serverMembers[p.serverId] || []).map((m) =>
            m.userId === p.userId ? { ...m, role: p.role } : m
          )
        }
      }))
    }))

    unsubs.push(window.api.signaling.onServerEvent('you-were-kicked', async (payload) => {
      const p = payload as { serverId: string; serverName?: string }
      await window.api.server.removeLocal(p.serverId)
      await get().reloadFromDb()
      set({ lastError: 'You were kicked from a server.' })
      notify({
        type: 'server-kick',
        title: 'Removed from server',
        body: p.serverName ? `You were kicked from ${p.serverName}` : 'You were kicked from a server',
        route: '/channels/@me',
        force: true
      })
    }))

    unsubs.push(window.api.signaling.onServerEvent('you-were-banned', async (payload) => {
      const p = payload as { serverId: string; serverName?: string }
      await window.api.server.removeLocal(p.serverId)
      await get().reloadFromDb()
      set({ lastError: 'You were banned from a server.' })
      notify({
        type: 'server-kick',
        title: 'Banned from server',
        body: p.serverName ? `You were banned from ${p.serverName}` : 'You were banned from a server',
        route: '/channels/@me',
        force: true
      })
    }))

    // A host (re-)registered their server on signaling. If we're a member of
    // it, silently rejoin the room — covers the race where our auto-rejoin
    // was denied ("Host is currently offline") because our socket connected
    // before the host's did. Without this, members received no server
    // events until an app restart.
    unsubs.push(window.api.signaling.onServerEvent('host-online', async (payload) => {
      const p = payload as { serverId: string }
      if (!p?.serverId) return
      const identity = useIdentityStore.getState().identity
      if (!identity) return
      const known = get().servers.find((s) => s.id === p.serverId)
      if (!known || known.role === 'host') return
      await window.api.server.join({
        serverId: p.serverId,
        userId: identity.userId,
        username: identity.username,
        avatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null
      }).catch(() => { /* silent — this is a background rejoin */ })
    }))

    unsubs.push(window.api.signaling.onServerEvent('error', (payload) => {
      const p = payload as { reason: string }
      // Clear any in-flight join so the ServerPage exits the spinner state and
      // renders the error UI. Without this, a failed join leaves pendingJoin set
      // and the user stares at a spinner forever.
      set({ pendingJoin: null, lastError: p.reason })
    }))

    unsubs.push(window.api.signaling.onServerEvent('message-edit', async (payload) => {
      const p = payload as { serverId: string; messageId: string; content: string; editedAt: number }
      await window.api.server.applyMessageEdit(p)
      set((s) => ({
        serverMessages: {
          ...s.serverMessages,
          [p.serverId]: (s.serverMessages[p.serverId] || []).map((m) =>
            m.id === p.messageId ? { ...m, content: p.content, editedAt: p.editedAt } : m
          )
        }
      }))
    }))

    unsubs.push(window.api.signaling.onServerEvent('message-delete', async (payload) => {
      const p = payload as { serverId: string; messageId: string }
      await window.api.server.applyMessageDelete(p)
      set((s) => ({
        serverMessages: {
          ...s.serverMessages,
          [p.serverId]: (s.serverMessages[p.serverId] || []).map((m) =>
            m.id === p.messageId ? { ...m, content: '', isDeleted: true, file: null } : m
          )
        }
      }))
    }))

    unsubs.push(window.api.signaling.onServerEvent('message-reaction', async (payload) => {
      const p = payload as {
        serverId: string; messageId: string; emojiId: string;
        userId: string; add: boolean; reactions?: Record<string, string[]>
      }
      // Full-map snapshot wins when present; otherwise fall back to delta merge.
      if (p.reactions && typeof p.reactions === 'object') {
        get().applyRemoteServerReactionFull(p.serverId, p.messageId, p.reactions)
      } else {
        get().applyRemoteServerReaction(p.serverId, p.messageId, p.emojiId, p.userId, p.add)
      }
      await window.api.reaction.applyServer({
        messageId: p.messageId,
        emojiId: p.emojiId,
        userId: p.userId,
        add: p.add
      }).catch(console.error)
    }))

    unsubs.push(window.api.signaling.onServerEvent('voice-joined', async (payload) => {
      const p = payload as { serverId: string; userId: string; channelId: string }
      set((s) => {
        const sr = s.serverVoiceStates[p.serverId] || {}
        return {
          serverVoiceStates: {
            ...s.serverVoiceStates,
            [p.serverId]: { ...sr, [p.userId]: p.channelId }
          }
        }
      })
    }))

    unsubs.push(window.api.signaling.onServerEvent('voice-left', async (payload) => {
      const p = payload as { serverId: string; userId: string }
      set((s) => {
        const sr = { ...(s.serverVoiceStates[p.serverId] || {}) }
        delete sr[p.userId]
        return {
          serverVoiceStates: {
            ...s.serverVoiceStates,
            [p.serverId]: sr
          }
        }
      })
    }))

    return () => { for (const u of unsubs) u() }
  },

  reregisterOnReconnect: async () => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.server.reregisterMine({ selfUserId: identity.userId })
  }
}))
