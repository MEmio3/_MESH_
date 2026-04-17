import { create } from 'zustand'
import { webrtcManager } from '@/lib/webrtc'
import { useIdentityStore } from './identity.store'

interface AvatarStore {
  self: string | null // data URL
  byUser: Record<string, string | null>

  initialize: () => Promise<void>
  uploadSelf: () => Promise<{ success: boolean; error?: string }>
  ensureFor: (userId: string) => Promise<string | null>
  sendToPeer: (userId: string) => Promise<void>
  broadcastToUsers: (userIds: string[]) => Promise<void>
  handleIncoming: (userId: string, base64: string) => Promise<void>
}

export const useAvatarStore = create<AvatarStore>((set, get) => ({
  self: null,
  byUser: {},

  initialize: async () => {
    const self = await window.api.avatar.getSelf()
    set({ self })
  },

  uploadSelf: async () => {
    const res = await window.api.avatar.pickAndSet()
    if (res.success && res.dataUrl) {
      set({ self: res.dataUrl })
      // Push to currently-connected friends (best-effort).
      const friendIds = webrtcManager.connectedPeerIds?.() ?? []
      for (const fid of friendIds) {
        get().sendToPeer(fid).catch(() => {})
      }
    }
    return { success: res.success, error: res.error }
  },

  ensureFor: async (userId) => {
    if (get().byUser[userId] !== undefined) return get().byUser[userId]
    const data = await window.api.avatar.getForUser(userId)
    set((s) => ({ byUser: { ...s.byUser, [userId]: data } }))
    return data
  },

  sendToPeer: async (userId) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const base64 = await window.api.avatar.getSelfBase64()
    if (!base64) return
    const payload = JSON.stringify({ type: 'avatar-sync', fromUserId: identity.userId, base64 })
    // Prefer the P2P data channel. Fall back to signaling-relayed DM so the
    // avatar still propagates when the channel isn't open yet (e.g. right
    // after a friend is added, or for server members we never had a DM with).
    const delivered = webrtcManager.sendDataMessage?.(userId, payload) ?? false
    if (!delivered) {
      try { window.api.signaling.emit('dm-message', userId, payload) } catch { /* ignore */ }
    }
  },

  broadcastToUsers: async (userIds) => {
    if (!userIds.length) return
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const base64 = await window.api.avatar.getSelfBase64()
    if (!base64) return
    const payload = JSON.stringify({ type: 'avatar-sync', fromUserId: identity.userId, base64 })
    for (const uid of userIds) {
      if (uid === identity.userId) continue
      const delivered = webrtcManager.sendDataMessage?.(uid, payload) ?? false
      if (!delivered) {
        try { window.api.signaling.emit('dm-message', uid, payload) } catch { /* ignore */ }
      }
    }
  },

  handleIncoming: async (userId, base64) => {
    const res = await window.api.avatar.saveForUser({ userId, base64 })
    if (res.success) {
      const data = await window.api.avatar.getForUser(userId)
      set((s) => ({ byUser: { ...s.byUser, [userId]: data } }))
    }
  }
}))
