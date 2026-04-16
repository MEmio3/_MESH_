import { create } from 'zustand'
import type { Server, ServerMember } from '@/types/server'
import type { Message } from '@/types/messages'
import { useIdentityStore } from './identity.store'
import { notify } from '@/lib/notify'

interface ServersStore {
  servers: Server[]
  serverMembers: Record<string, ServerMember[]>
  serverMessages: Record<string, Message[]>
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
  sendServerMessage: (serverId: string, content: string) => Promise<void>
  muteMember: (serverId: string, targetId: string, mute: boolean) => Promise<void>
  kickMember: (serverId: string, targetId: string) => Promise<void>
  banMember: (serverId: string, targetId: string) => Promise<void>
  setMemberRole: (serverId: string, targetId: string, role: 'moderator' | 'member') => Promise<void>
  editServerMessage: (serverId: string, messageId: string, newContent: string) => Promise<void>
  deleteServerMessage: (serverId: string, messageId: string) => Promise<void>
  toggleServerReaction: (serverId: string, messageId: string, emojiId: string) => Promise<void>
  applyRemoteServerReaction: (serverId: string, messageId: string, emojiId: string, userId: string, add: boolean) => void
  subscribeToServerEvents: () => () => void
  reregisterOnReconnect: () => Promise<void>
}

function toServer(r: {
  id: string; name: string; iconColor: string; role: string; textChannelName: string;
  voiceRoomName: string; memberCount: number; onlineMemberCount: number
}): Server {
  return {
    id: r.id,
    name: r.name,
    iconColor: r.iconColor,
    role: r.role as Server['role'],
    textChannelName: r.textChannelName,
    voiceRoomName: r.voiceRoomName,
    memberCount: r.memberCount,
    onlineMemberCount: r.onlineMemberCount
  }
}

export const useServersStore = create<ServersStore>((set, get) => ({
  servers: [],
  serverMembers: {},
  serverMessages: {},
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
    for (const srv of servers) {
      const memberRows = await window.api.db.serverMembers.list(srv.id)
      serverMembers[srv.id] = memberRows.map((m) => ({
        userId: m.userId,
        username: m.username,
        avatarColor: m.avatarColor,
        role: m.role as ServerMember['role'],
        status: m.status as ServerMember['status'],
        isMuted: m.isMuted === 1
      }))
      const msgRows = await window.api.db.serverMessages.list({ serverId: srv.id, limit: 50 })
      serverMessages[srv.id] = msgRows.reverse() as Message[]
    }
    set({ servers, serverMembers, serverMessages })
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

  sendServerMessage: async (serverId, content) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const res = await window.api.server.sendMessage({
      serverId,
      senderId: identity.userId,
      senderName: identity.username,
      content
    })
    if (res.success && res.messageId) {
      const msg: Message = {
        id: res.messageId,
        conversationId: serverId,
        senderId: identity.userId,
        senderName: identity.username,
        content,
        timestamp: Date.now(),
        status: 'sent'
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
      selfMember?.role === 'moderator'
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

    await window.api.reaction.toggleServer({
      serverId,
      messageId,
      emojiId,
      userId: selfId,
      add
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
      // Validate payload structure before processing
      if (!payload || typeof payload !== 'object' || !('server' in payload) || !payload.server) {
        console.error('[servers.store] Invalid join-ack payload:', payload)
        set({ pendingJoin: null, lastError: 'Invalid server response from signaling' })
        return
      }
      try {
        await window.api.server.joinAckPersist(payload)
        await get().reloadFromDb()
        set({ pendingJoin: null })
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
    }))

    unsubs.push(window.api.signaling.onServerEvent('member-left', (payload) => {
      const p = payload as { serverId: string; userId: string }
      set((s) => ({
        serverMembers: {
          ...s.serverMembers,
          [p.serverId]: (s.serverMembers[p.serverId] || []).filter((m) => m.userId !== p.userId)
        }
      }))
    }))

    unsubs.push(window.api.signaling.onServerEvent('message', async (payload) => {
      const p = payload as { serverId: string; message: { id: string; senderId: string; senderName: string; content: string; timestamp: number } }
      await window.api.server.messageRemote(p)
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
          status: 'delivered'
        }
        return { serverMessages: { ...s.serverMessages, [p.serverId]: [...existing, msg] } }
      })
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

    unsubs.push(window.api.signaling.onServerEvent('error', (payload) => {
      const p = payload as { reason: string }
      set({ lastError: p.reason })
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
      const p = payload as { serverId: string; messageId: string; emojiId: string; userId: string; add: boolean }
      get().applyRemoteServerReaction(p.serverId, p.messageId, p.emojiId, p.userId, p.add)
      await window.api.reaction.applyServer({
        messageId: p.messageId,
        emojiId: p.emojiId,
        userId: p.userId,
        add: p.add
      }).catch(console.error)
    }))

    return () => { for (const u of unsubs) u() }
  },

  reregisterOnReconnect: async () => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.server.reregisterMine({ selfUserId: identity.userId })
  }
}))
