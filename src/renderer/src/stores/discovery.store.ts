import { create } from 'zustand'
import { useIdentityStore } from './identity.store'
import { useSettingsStore } from './settings.store'

export interface NearbyUser {
  userId: string
  username: string
  avatarColor: string | null
}

interface DiscoveryStore {
  nearby: NearbyUser[]
  loading: boolean

  refresh: () => Promise<void>
  publishSelf: () => Promise<void>
  subscribe: () => () => void
}

export const useDiscoveryStore = create<DiscoveryStore>((set, get) => ({
  nearby: [],
  loading: false,

  refresh: async () => {
    set({ loading: true })
    try {
      const [list, blocked] = await Promise.all([
        window.api.presence.list(),
        window.api.block.list()
      ])
      const blockedIds = new Set(blocked.map((b) => b.userId))
      const selfId = useIdentityStore.getState().identity?.userId
      // MERGE rather than replace: presence.list() only returns the PRIMARY
      // host's roster, but we may also be attached to other hosts whose people
      // arrived via presence:snapshot/changed. Replacing would wipe them.
      // Stale entries are removed by presence:changed{removed} events.
      set((s) => {
        const byId = new Map(s.nearby.map((u) => [u.userId, u]))
        for (const id of blockedIds) byId.delete(id)
        for (const u of list) {
          if (u.userId === selfId || blockedIds.has(u.userId)) continue
          byId.set(u.userId, u)
        }
        return { nearby: [...byId.values()], loading: false }
      })
    } catch {
      set({ loading: false })
    }
  },

  publishSelf: async () => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    const { privacy } = useSettingsStore.getState()
    await window.api.presence.update({
      username: identity.username,
      avatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null,
      hidden: !!privacy.hideFromDiscovery
    })
  },

  subscribe: () => {
    const unsubs: Array<() => void> = []
    // Full roster pushed by the host whenever we announce ourselves — the
    // reliable way to see everyone already present (no fragile ack round-trip).
    unsubs.push(
      window.api.signaling.onPresenceSnapshot(async (list) => {
        const selfId = useIdentityStore.getState().identity?.userId
        const blocked = await window.api.block.list().catch(() => [])
        const blockedIds = new Set(blocked.map((b) => b.userId))
        const clean = list.filter((u) => u.userId !== selfId && !blockedIds.has(u.userId))
        set((s) => {
          const byId = new Map(s.nearby.map((u) => [u.userId, u]))
          for (const u of clean) {
            byId.set(u.userId, { userId: u.userId, username: u.username, avatarColor: u.avatarColor ?? null })
          }
          return { nearby: [...byId.values()] }
        })
      })
    )
    unsubs.push(
      window.api.signaling.onPresenceChanged(async (p) => {
        const payload = p as { userId: string; username?: string; avatarColor?: string | null; hidden?: boolean; removed?: true }
        const selfId = useIdentityStore.getState().identity?.userId
        if (payload.userId === selfId) return
        if (await window.api.block.isBlocked({ userId: payload.userId })) return
        set((s) => {
          if (payload.removed || payload.hidden) {
            return { nearby: s.nearby.filter((u) => u.userId !== payload.userId) }
          }
          if (!payload.username) return {}
          const existing = s.nearby.find((u) => u.userId === payload.userId)
          const next: NearbyUser = {
            userId: payload.userId,
            username: payload.username,
            avatarColor: payload.avatarColor ?? null
          }
          return {
            nearby: existing
              ? s.nearby.map((u) => (u.userId === payload.userId ? next : u))
              : [...s.nearby, next]
          }
        })
      })
    )
    // After signaling connects we should also refresh + publish.
    unsubs.push(
      window.api.signaling.onConnected(() => {
        get().publishSelf()
        get().refresh()
      })
    )
    return () => { for (const u of unsubs) u() }
  }
}))
