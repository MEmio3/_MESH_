import { create } from 'zustand'
import { useIdentityStore } from './identity.store'
import { useSettingsStore } from './settings.store'

export interface NearbyUser {
  userId: string
  username: string
  avatarColor: string | null
  hostUrls?: string[]
}

type PresenceHostMap = Record<string, Record<string, NearbyUser>>

interface DiscoveryStore {
  nearby: NearbyUser[]
  presenceByHost: PresenceHostMap
  loading: boolean

  refresh: () => Promise<void>
  publishSelf: () => Promise<void>
  subscribe: () => () => void
}

const UNKNOWN_HOST = '__primary__'

function hostKey(hostUrl?: string): string {
  return hostUrl?.replace(/\/+$/, '') || UNKNOWN_HOST
}

function flattenPresence(
  presenceByHost: PresenceHostMap,
  blockedIds: Set<string>,
  selfId?: string
): NearbyUser[] {
  const byUser = new Map<string, NearbyUser>()

  for (const [hostUrl, users] of Object.entries(presenceByHost)) {
    for (const user of Object.values(users)) {
      if (user.userId === selfId || blockedIds.has(user.userId)) continue
      const existing = byUser.get(user.userId)
      const hostUrls = existing?.hostUrls ? [...existing.hostUrls] : []
      if (!hostUrls.includes(hostUrl)) hostUrls.push(hostUrl)
      byUser.set(user.userId, {
        userId: user.userId,
        username: user.username || existing?.username || user.userId,
        avatarColor: user.avatarColor ?? existing?.avatarColor ?? null,
        hostUrls
      })
    }
  }

  return [...byUser.values()].sort((a, b) => a.username.localeCompare(b.username))
}

async function blockedUserIds(): Promise<Set<string>> {
  const blocked = await window.api.block.list().catch(() => [])
  return new Set(blocked.map((b) => b.userId))
}

export const useDiscoveryStore = create<DiscoveryStore>((set, get) => ({
  nearby: [],
  presenceByHost: {},
  loading: false,

  refresh: async () => {
    set({ loading: true })
    try {
      await get().publishSelf().catch(() => {})
      const [list, blockedIds, hosts] = await Promise.all([
        window.api.presence.list(),
        blockedUserIds(),
        window.api.signaling.listHosts().catch(() => [])
      ])
      const selfId = useIdentityStore.getState().identity?.userId
      set((s) => {
        const nextByHost: PresenceHostMap = { ...s.presenceByHost }
        const primaryKey = hosts.length > 0 ? hostKey(hosts[0]) : UNKNOWN_HOST
        const primaryUsers: Record<string, NearbyUser> = {}
        for (const u of list) {
          if (u.userId === selfId || blockedIds.has(u.userId)) continue
          primaryUsers[u.userId] = { userId: u.userId, username: u.username, avatarColor: u.avatarColor ?? null }
        }
        nextByHost[primaryKey] = primaryUsers
        return {
          presenceByHost: nextByHost,
          nearby: flattenPresence(nextByHost, blockedIds, selfId),
          loading: false
        }
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

    unsubs.push(
      window.api.signaling.onPresenceSnapshot(async (list, hostUrl) => {
        const selfId = useIdentityStore.getState().identity?.userId
        const blockedIds = await blockedUserIds()
        const clean = list.filter((u) => u.userId !== selfId && !blockedIds.has(u.userId))
        set((s) => {
          const key = hostKey(hostUrl)
          const nextHostUsers: Record<string, NearbyUser> = {}
          for (const u of clean) {
            nextHostUsers[u.userId] = {
              userId: u.userId,
              username: u.username,
              avatarColor: u.avatarColor ?? null
            }
          }
          const nextByHost = { ...s.presenceByHost, [key]: nextHostUsers }
          return {
            presenceByHost: nextByHost,
            nearby: flattenPresence(nextByHost, blockedIds, selfId)
          }
        })
      })
    )

    unsubs.push(
      window.api.signaling.onPresenceChanged(async (p, hostUrl) => {
        const payload = p as {
          userId: string
          username?: string
          avatarColor?: string | null
          hidden?: boolean
          removed?: true
        }
        const selfId = useIdentityStore.getState().identity?.userId
        if (payload.userId === selfId) return
        const blockedIds = await blockedUserIds()
        if (blockedIds.has(payload.userId)) return
        set((s) => {
          const key = hostKey(hostUrl)
          const hostUsers = { ...(s.presenceByHost[key] ?? {}) }
          if (payload.removed || payload.hidden) {
            delete hostUsers[payload.userId]
            const nextByHost = { ...s.presenceByHost, [key]: hostUsers }
            return {
              presenceByHost: nextByHost,
              nearby: flattenPresence(nextByHost, blockedIds, selfId)
            }
          }
          if (!payload.username) return {}
          hostUsers[payload.userId] = {
            userId: payload.userId,
            username: payload.username,
            avatarColor: payload.avatarColor ?? null
          }
          const nextByHost = { ...s.presenceByHost, [key]: hostUsers }
          return {
            presenceByHost: nextByHost,
            nearby: flattenPresence(nextByHost, blockedIds, selfId)
          }
        })
      })
    )

    unsubs.push(
      window.api.signaling.onHostsChanged(async (hosts) => {
        const activeHosts = new Set(hosts.map(hostKey))
        const blockedIds = await blockedUserIds()
        const selfId = useIdentityStore.getState().identity?.userId
        set((s) => {
          const nextByHost: PresenceHostMap = {}
          for (const [key, users] of Object.entries(s.presenceByHost)) {
            if (activeHosts.has(key)) nextByHost[key] = users
          }
          return {
            presenceByHost: nextByHost,
            nearby: flattenPresence(nextByHost, blockedIds, selfId)
          }
        })
      })
    )

    unsubs.push(
      window.api.signaling.onConnected(() => {
        get().refresh()
      })
    )

    return () => { for (const u of unsubs) u() }
  }
}))
