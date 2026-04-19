import { create } from 'zustand'
import type { Friend, FriendRequest, MessageRequest, MessageRequestThreadMessage, BlockedUser } from '@/types/social'
import { useIdentityStore } from './identity.store'
import { useMessagesStore } from './messages.store'
import { useAvatarStore } from './avatar.store'
import { notify } from '@/lib/notify'
import { playFriendNotification } from '@/lib/sounds'

interface FriendsStore {
  friends: Friend[]
  friendRequests: FriendRequest[]
  messageRequests: MessageRequest[]
  blockedUsers: BlockedUser[]

  initialize: () => Promise<void>
  subscribeToSignaling: () => () => void
  sendFriendRequest: (userId: string) => Promise<{ success: boolean; error?: string }>
  acceptRequest: (requestId: string) => Promise<void>
  declineRequest: (requestId: string) => Promise<void>
  cancelRequest: (requestId: string) => Promise<void>
  removeFriend: (userId: string) => void
  blockUser: (userId: string) => Promise<void>
  unblockUser: (userId: string) => Promise<void>
  acceptMessageRequest: (requestId: string) => void
  declineMessageRequest: (requestId: string) => void

  // Message-request thread ops
  sendMessageRequest: (toUserId: string, content: string) => Promise<{ success: boolean; error?: string }>
  replyMessageRequest: (otherUserId: string, content: string) => Promise<{ success: boolean; error?: string }>
  ignoreMessageRequest: (requestId: string) => Promise<void>
  blockFromMessageRequest: (otherUserId: string, otherUsername: string) => Promise<void>
  loadMessageRequestThread: (otherUserId: string) => Promise<MessageRequestThreadMessage[]>
}

function reloadFriends(): Promise<Friend[]> {
  return window.api.db.friends.list() as Promise<Friend[]>
}
function reloadRequests(): Promise<FriendRequest[]> {
  return window.api.db.friendRequests.list() as Promise<FriendRequest[]>
}
function reloadMessageRequests(): Promise<MessageRequest[]> {
  return window.api.db.messageRequests.list() as Promise<MessageRequest[]>
}

export const useFriendsStore = create<FriendsStore>((set, get) => ({
  friends: [],
  friendRequests: [],
  messageRequests: [],
  blockedUsers: [],

  initialize: async () => {
    const [friends, friendRequests, messageRequests, blockedUsers] = await Promise.all([
      reloadFriends(),
      reloadRequests(),
      window.api.db.messageRequests.list(),
      window.api.db.blocked.list()
    ])
    set({
      friends,
      friendRequests,
      messageRequests: messageRequests as MessageRequest[],
      blockedUsers
    })
  },

  /** Wire signaling events → DB writes → store refresh. Returns an unsubscribe. */
  subscribeToSignaling: () => {
    const unsubs: Array<() => void> = []

    unsubs.push(
      window.api.signaling.onFriendRequestIncoming(async (payload) => {
        const p = payload as {
          id: string
          fromUserId: string
          fromUsername: string
          fromAvatarColor: string | null
          toUserId: string
          timestamp: number
        }
        const res = await window.api.friendRequest.receive(p)
        if (res.success) {
          set({ friendRequests: await reloadRequests() })
          playFriendNotification()
          notify({
            type: 'friend-request',
            title: 'New friend request',
            body: `${p.fromUsername} wants to add you as a friend`,
            route: '/channels/@me'
          })
        }
      })
    )

    unsubs.push(
      window.api.signaling.onFriendRequestAccepted(async (payload) => {
        const p = payload as {
          requestId: string
          fromUserId: string
          fromUsername: string
          fromAvatarColor: string | null
          toUserId: string
        }
        await window.api.friendRequest.acceptedRemote(p)
        const [friends, requests] = await Promise.all([reloadFriends(), reloadRequests()])
        set({ friends, friendRequests: requests })
        // Refresh DM sidebar so the new friend's conversation appears live.
        await useMessagesStore.getState().initialize()
        // Push our avatar to the new friend so their FriendItem / DM shows a
        // real picture instead of coloured initials. Falls back to signaling
        // when the P2P data channel isn't open yet.
        useAvatarStore.getState().sendToPeer(p.fromUserId).catch(() => {})
        playFriendNotification()
        notify({
          type: 'friend-request',
          title: 'Friend request accepted',
          body: `${p.fromUsername} is now your friend`,
          route: '/channels/@me'
        })
      })
    )

    unsubs.push(
      window.api.signaling.onFriendRequestCancelled(async (payload) => {
        const p = payload as { requestId: string }
        await window.api.friendRequest.cancelledRemote(p)
        set({ friendRequests: await reloadRequests() })
      })
    )

    // Rejected = silent per spec but we must clear our outgoing entry.
    unsubs.push(
      window.api.signaling.onFriendRequestRejected(async (payload) => {
        const p = payload as { requestId: string }
        await window.api.friendRequest.rejectedRemote(p)
        set({ friendRequests: await reloadRequests() })
      })
    )

    // Message-request events
    unsubs.push(
      window.api.signaling.onMessageRequestIncoming(async (payload) => {
        await window.api.messageRequest.receive(payload)
        set({ messageRequests: await reloadMessageRequests() })
        const p = payload as { fromUsername?: string; content?: string }
        notify({
          type: 'dm',
          title: `Message request from ${p.fromUsername || 'someone'}`,
          body: p.content ? String(p.content).slice(0, 140) : 'New message request',
          route: '/channels/@me'
        })
      })
    )

    unsubs.push(
      window.api.signaling.onMessageRequestMessage(async (payload) => {
        await window.api.messageRequest.messageRemote(payload)
        set({ messageRequests: await reloadMessageRequests() })
        // A remote reply may have promoted our outgoing request into a real
        // DM conversation (upserted main-side). Reload the messages store so
        // the new DM appears immediately in the sidebar.
        await useMessagesStore.getState().initialize()
      })
    )

    return () => unsubs.forEach((u) => u())
  },

  sendFriendRequest: async (targetUserId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return { success: false, error: 'No identity loaded.' }

    const trimmed = targetUserId.trim()
    if (!trimmed.startsWith('usr_') || trimmed.length < 10) {
      return { success: false, error: 'Invalid User ID.' }
    }

    const payload = {
      id: `fr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromUserId: identity.userId,
      fromUsername: identity.username,
      fromAvatarColor: identity.avatarPath,
      toUserId: trimmed,
      timestamp: Date.now()
    }
    const res = await window.api.friendRequest.send(payload)
    if (res.success) {
      set({ friendRequests: await reloadRequests() })
    }
    return res
  },

  acceptRequest: async (requestId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const req = get().friendRequests.find((r) => r.id === requestId)
    if (!req) return

    // The main process now seamlessly handles both incoming and outgoing directions
    // by gracefully swapping the from/to user IDs when necessary, completely eliminating
    // mutual request deadlocks.

    const res = await window.api.friendRequest.accept({
      requestId,
      selfUserId: identity.userId,
      selfUsername: identity.username,
      selfAvatarColor: identity.avatarPath
    })
    if (res.success) {
      const [friends, requests] = await Promise.all([reloadFriends(), reloadRequests()])
      set({ friends, friendRequests: requests })
      // Refresh DM sidebar so the new friend's conversation appears live.
      await useMessagesStore.getState().initialize()
      // Push our avatar to the person we just accepted so they see our real
      // picture on their side (and not just coloured initials).
      if (res.friend?.userId) {
        useAvatarStore.getState().sendToPeer(res.friend.userId).catch(() => {})
      }
    }
  },

  declineRequest: async (requestId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.friendRequest.reject({ requestId, selfUserId: identity.userId })
    set({ friendRequests: await reloadRequests() })
  },

  cancelRequest: async (requestId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.friendRequest.cancel({ requestId, selfUserId: identity.userId })
    set({ friendRequests: await reloadRequests() })
  },

  removeFriend: (userId) => {
    set((state) => ({ friends: state.friends.filter((f) => f.userId !== userId) }))
    window.api.db.friends.remove(userId)
  },

  blockUser: async (userId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const friend = get().friends.find((f) => f.userId === userId)
    const mr = get().messageRequests.find((r) => r.fromUserId === userId || r.toUserId === userId)
    const username = friend?.username || mr?.fromUsername || mr?.toUsername || userId
    await window.api.block.user({ selfUserId: identity.userId, targetUserId: userId, targetUsername: username })
    const [friends, friendRequests, messageRequests, blockedUsers] = await Promise.all([
      reloadFriends(),
      reloadRequests(),
      reloadMessageRequests(),
      window.api.db.blocked.list()
    ])
    set({ friends, friendRequests, messageRequests, blockedUsers })
  },

  unblockUser: async (userId) => {
    await window.api.block.unblock({ targetUserId: userId })
    set({ blockedUsers: await window.api.db.blocked.list() })
  },

  acceptMessageRequest: (_requestId) => {
    // Kept for type compat — UI now uses replyMessageRequest instead.
  },

  declineMessageRequest: async (requestId) => {
    await window.api.messageRequest.ignore({ requestId })
    set({ messageRequests: await reloadMessageRequests() })
  },

  sendMessageRequest: async (toUserId, content) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return { success: false, error: 'No identity.' }
    const trimmed = toUserId.trim()
    if (!trimmed.startsWith('usr_') || trimmed.length < 10) {
      return { success: false, error: 'Invalid User ID.' }
    }
    const res = await window.api.messageRequest.send({
      fromUserId: identity.userId,
      fromUsername: identity.username,
      fromAvatarColor: identity.avatarPath,
      toUserId: trimmed,
      content,
      timestamp: Date.now()
    })
    if (res.success) {
      set({ messageRequests: await reloadMessageRequests() })
    }
    return res
  },

  replyMessageRequest: async (otherUserId, content) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return { success: false, error: 'No identity.' }
    const res = await window.api.messageRequest.reply({
      selfUserId: identity.userId,
      selfUsername: identity.username,
      selfAvatarColor: identity.avatarPath,
      otherUserId,
      content,
      timestamp: Date.now()
    })
    if (res.success) {
      set({ messageRequests: await reloadMessageRequests() })
      // The reply just promoted the message-request into a real conversation
      // (upserted main-side). Reload the messages store so the new DM appears
      // immediately in the sidebar without needing a full re-initialise.
      await useMessagesStore.getState().initialize()
    }
    return res
  },

  ignoreMessageRequest: async (requestId) => {
    await window.api.messageRequest.ignore({ requestId })
    set({ messageRequests: await reloadMessageRequests() })
  },

  blockFromMessageRequest: async (otherUserId, otherUsername) => {
    await window.api.messageRequest.block({ otherUserId, otherUsername })
    const [mrs, blocked] = await Promise.all([
      reloadMessageRequests(),
      window.api.db.blocked.list()
    ])
    set({ messageRequests: mrs, blockedUsers: blocked })
  },

  loadMessageRequestThread: async (otherUserId) => {
    return (await window.api.messageRequest.thread(otherUserId)) as MessageRequestThreadMessage[]
  }
}))
