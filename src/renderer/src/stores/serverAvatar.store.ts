/**
 * Server-avatar renderer store. Mirrors `avatar.store.ts` but keyed by
 * serverId. Populated eagerly on startup so the rail + sidebars render the
 * right image without a flash of fallback initials.
 */
import { create } from 'zustand'
import { useIdentityStore } from './identity.store'

async function reregisterHostedServers(): Promise<void> {
  const identity = useIdentityStore.getState().identity
  if (!identity) return
  await window.api.server.reregisterMine({
    selfUserId: identity.userId,
    selfUsername: identity.username,
    selfAvatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null
  }).catch(() => { /* retried on next reconnect */ })
}

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
      await reregisterHostedServers()
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
    await reregisterHostedServers()
  },

  setLocal: (serverId, dataUrl) => {
    set((s) => ({ byServer: { ...s.byServer, [serverId]: dataUrl } }))
  }
}))
