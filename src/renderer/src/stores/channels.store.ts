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

export interface Channel {
  id: string
  serverId: string
  categoryId: string | null
  name: string
  type: 'text' | 'voice'
  position: number
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
    set((s) => ({
      byServer: {
        ...s.byServer,
        [serverId]: {
          categories: [...res.categories].sort((a, b) => a.position - b.position),
          channels: [...res.channels].sort((a, b) => a.position - b.position)
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
  }
}))

/** Convenience selector for components that just need the list for one server. */
export function useServerLayout(serverId: string): ServerLayout {
  return useChannelsStore((s) => s.byServer[serverId]) ?? EMPTY_LAYOUT
}
