/**
 * Per-server categories + channels store. Mirrors the layout held in
 * main-process SQLite: categories are ordered buckets, channels are
 * ordered items that optionally point at a category.
 *
 * All mutations are gated in the main process to host/moderator; this store
 * just forwards the actor id and then re-reads the authoritative list to
 * keep local state in sync.
 */
import { create } from 'zustand'
import { useIdentityStore } from './identity.store'

export interface ChannelCategory {
  id: string
  serverId: string
  name: string
  position: number
}

export type ChannelMinRole = 'member' | 'moderator' | 'host'

export interface Channel {
  id: string
  serverId: string
  categoryId: string | null
  name: string
  type: 'text' | 'voice'
  position: number
  /** Minimum role required to see this channel (legacy tier gate). */
  minRole: ChannelMinRole
  /** Custom role ids allowed to see this channel; null = everyone.
   *  Takes precedence over minRole when set. Host always sees everything. */
  allowedRoleIds: string[] | null
  /** Voice: target audio bitrate in kbps; null = codec default. */
  bitrateKbps: number | null
  /** Voice: max simultaneous members; 0 = unlimited. Host bypasses. */
  userLimit: number
  /** Text: role ids allowed to send; null = everyone with the global perm. */
  sendRoleIds: string[] | null
}

interface ServerLayout {
  categories: ChannelCategory[]
  channels: Channel[]
}

interface ChannelsStore {
  byServer: Record<string, ServerLayout>

  load: (serverId: string) => Promise<void>
  reload: (serverId: string) => Promise<void>

  createCategory: (serverId: string, name: string) => Promise<{ success: boolean; error?: string; categoryId?: string }>
  createChannel: (serverId: string, name: string, type: 'text' | 'voice', categoryId?: string | null) => Promise<{ success: boolean; error?: string; channelId?: string }>
  renameChannel: (serverId: string, channelId: string, name: string) => Promise<{ success: boolean; error?: string }>
  renameCategory: (serverId: string, categoryId: string, name: string) => Promise<{ success: boolean; error?: string }>
  deleteChannel: (serverId: string, channelId: string) => Promise<{ success: boolean; error?: string }>
  deleteCategory: (serverId: string, categoryId: string) => Promise<{ success: boolean; error?: string }>
  setChannelAccess: (serverId: string, channelId: string, minRole: ChannelMinRole) => Promise<{ success: boolean; error?: string }>
  setChannelRoles: (serverId: string, channelId: string, allowedRoleIds: string[] | null) => Promise<{ success: boolean; error?: string }>
  setChannelSendRoles: (serverId: string, channelId: string, sendRoleIds: string[] | null) => Promise<{ success: boolean; error?: string }>
  updateChannelSettings: (serverId: string, channelId: string, bitrateKbps: number | null, userLimit: number) => Promise<{ success: boolean; error?: string }>
}

const EMPTY_LAYOUT: ServerLayout = { categories: [], channels: [] }

function selfId(): string {
  return useIdentityStore.getState().identity?.userId ?? ''
}

export const useChannelsStore = create<ChannelsStore>((set, get) => ({
  byServer: {},

  load: async (serverId) => {
    if (get().byServer[serverId]) return
    await get().reload(serverId)
  },

  reload: async (serverId) => {
    const res = await window.api.server.listChannels(serverId)
    const parseIds = (raw: string | null): string[] | null => {
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
      } catch {
        return null
      }
    }
    const channels: Channel[] = [...res.channels]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        ...c,
        allowedRoleIds: parseIds(c.allowedRoleIds),
        sendRoleIds: parseIds(c.sendRoleIds),
        bitrateKbps: c.bitrateKbps ?? null,
        userLimit: c.userLimit ?? 0
      }))
    set((s) => ({
      byServer: {
        ...s.byServer,
        [serverId]: {
          categories: [...res.categories].sort((a, b) => a.position - b.position),
          channels
        }
      }
    }))
  },

  createCategory: async (serverId, name) => {
    const res = await window.api.server.createCategory({ serverId, actorId: selfId(), name })
    if (res.success) await get().reload(serverId)
    return res
  },

  createChannel: async (serverId, name, type, categoryId = null) => {
    const res = await window.api.server.createChannel({ serverId, actorId: selfId(), name, type, categoryId })
    if (res.success) await get().reload(serverId)
    return res
  },

  renameChannel: async (serverId, channelId, name) => {
    const res = await window.api.server.renameChannel({ serverId, actorId: selfId(), channelId, name })
    if (res.success) await get().reload(serverId)
    return res
  },

  renameCategory: async (serverId, categoryId, name) => {
    const res = await window.api.server.renameCategory({ serverId, actorId: selfId(), categoryId, name })
    if (res.success) await get().reload(serverId)
    return res
  },

  deleteChannel: async (serverId, channelId) => {
    const res = await window.api.server.deleteChannel({ serverId, actorId: selfId(), channelId })
    if (res.success) await get().reload(serverId)
    return res
  },

  deleteCategory: async (serverId, categoryId) => {
    const res = await window.api.server.deleteCategory({ serverId, actorId: selfId(), categoryId })
    if (res.success) await get().reload(serverId)
    return res
  },

  setChannelAccess: async (serverId, channelId, minRole) => {
    const res = await window.api.server.setChannelAccess({ serverId, actorId: selfId(), channelId, minRole })
    if (res.success) await get().reload(serverId)
    return res
  },

  setChannelRoles: async (serverId, channelId, allowedRoleIds) => {
    const res = await window.api.server.setChannelRoles({ serverId, actorId: selfId(), channelId, allowedRoleIds })
    if (res.success) await get().reload(serverId)
    return res
  },

  setChannelSendRoles: async (serverId, channelId, sendRoleIds) => {
    const res = await window.api.server.setChannelSendRoles({ serverId, actorId: selfId(), channelId, sendRoleIds })
    if (res.success) await get().reload(serverId)
    return res
  },

  updateChannelSettings: async (serverId, channelId, bitrateKbps, userLimit) => {
    const res = await window.api.server.updateChannelSettings({ serverId, actorId: selfId(), channelId, bitrateKbps, userLimit })
    if (res.success) await get().reload(serverId)
    return res
  }
}))

/** Convenience selector for components that just need the list for one server. */
export function useServerLayout(serverId: string): ServerLayout {
  return useChannelsStore((s) => s.byServer[serverId]) ?? EMPTY_LAYOUT
}
