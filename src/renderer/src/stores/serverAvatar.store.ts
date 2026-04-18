/**
 * Server-avatar renderer store. Mirrors `avatar.store.ts` but keyed by
 * serverId. Populated eagerly on startup so the rail + sidebars render the
 * right image without a flash of fallback initials.
 */
import { create } from 'zustand'

interface ServerAvatarStore {
  byServer: Record<string, string>

  initialize: () => Promise<void>
  uploadForServer: (serverId: string) => Promise<{ success: boolean; error?: string; dataUrl?: string }>
  clearForServer: (serverId: string) => Promise<void>
  setLocal: (serverId: string, dataUrl: string) => void
}

export const useServerAvatarStore = create<ServerAvatarStore>((set) => ({
  byServer: {},

  initialize: async () => {
    const all = await window.api.serverAvatar.getAll()
    set({ byServer: all })
  },

  uploadForServer: async (serverId) => {
    const res = await window.api.serverAvatar.pickAndSet(serverId)
    if (res.success && res.dataUrl) {
      set((s) => ({ byServer: { ...s.byServer, [serverId]: res.dataUrl! } }))
    }
    return res
  },

  clearForServer: async (serverId) => {
    await window.api.serverAvatar.clear(serverId)
    set((s) => {
      const next = { ...s.byServer }
      delete next[serverId]
      return { byServer: next }
    })
  },

  setLocal: (serverId, dataUrl) => {
    set((s) => ({ byServer: { ...s.byServer, [serverId]: dataUrl } }))
  }
}))
