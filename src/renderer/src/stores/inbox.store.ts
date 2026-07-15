import { create } from 'zustand'
import type {
  InboxCountRow,
  InboxFilter,
  InboxItemRow,
  InboxNotificationMode,
  InboxRecordInput
} from '../../../shared/types'
import { useIdentityStore } from './identity.store'

export interface InboxItem extends Omit<InboxItemRow, 'isMention' | 'isReply' | 'isRead'> {
  isMention: boolean
  isReply: boolean
  isRead: boolean
}

interface RecordResult {
  inserted: boolean
  mode: InboxNotificationMode
  isReply: boolean
}

interface InboxStore {
  items: InboxItem[]
  counts: InboxCountRow[]
  preferences: Record<string, InboxNotificationMode>
  activeFilter: InboxFilter
  isLoading: boolean
  initialize: () => Promise<void>
  load: (filter?: InboxFilter) => Promise<void>
  refreshCounts: () => Promise<void>
  recordIncoming: (input: InboxRecordInput) => Promise<RecordResult>
  markMessageRead: (messageId: string) => Promise<void>
  markScopeRead: (scopeKey: string) => Promise<void>
  markAllRead: () => Promise<void>
  setPreference: (scopeKey: string, mode: InboxNotificationMode) => Promise<void>
}

export function dmInboxScope(conversationId: string): string {
  return `dm:${conversationId}`
}

export function serverInboxScope(serverId: string, channelId?: string | null): string {
  return `server:${serverId}:${channelId || 'default'}`
}

function mapInboxItem(row: InboxItemRow): InboxItem {
  return {
    ...row,
    isMention: Boolean(row.isMention),
    isReply: Boolean(row.isReply),
    isRead: Boolean(row.isRead)
  }
}

export const useInboxStore = create<InboxStore>((set, get) => ({
  items: [],
  counts: [],
  preferences: {},
  activeFilter: 'unread',
  isLoading: false,

  initialize: async () => {
    const selfUserId = useIdentityStore.getState().identity?.userId
    if (selfUserId) await window.api.db.inbox.backfillDm(selfUserId)
    const [counts, preferences, items] = await Promise.all([
      window.api.db.inbox.counts(),
      window.api.db.inbox.preferences(),
      window.api.db.inbox.list('unread', 250)
    ])
    set({
      counts,
      preferences: Object.fromEntries(preferences.map((entry) => [entry.scopeKey, entry.mode])),
      items: items.map(mapInboxItem),
      activeFilter: 'unread'
    })
  },

  load: async (filter = get().activeFilter) => {
    set({ isLoading: true, activeFilter: filter })
    try {
      const items = await window.api.db.inbox.list(filter, 250)
      if (get().activeFilter === filter) set({ items: items.map(mapInboxItem) })
    } finally {
      if (get().activeFilter === filter) set({ isLoading: false })
    }
  },

  refreshCounts: async () => {
    const counts = await window.api.db.inbox.counts()
    set({ counts })
  },

  recordIncoming: async (input) => {
    const result = await window.api.db.inbox.record(input)
    if (result.inserted) {
      await Promise.all([get().refreshCounts(), get().load()])
    }
    return result
  },

  markMessageRead: async (messageId) => {
    await window.api.db.inbox.markMessageRead(messageId)
    set((state) => ({
      items: state.activeFilter === 'unread'
        ? state.items.filter((item) => item.messageId !== messageId)
        : state.items.map((item) => item.messageId === messageId ? { ...item, isRead: true } : item)
    }))
    await get().refreshCounts()
  },

  markScopeRead: async (scopeKey) => {
    await window.api.db.inbox.markScopeRead(scopeKey)
    if (scopeKey.startsWith('dm:')) {
      const conversationId = scopeKey.slice(3)
      const { useMessagesStore } = await import('./messages.store')
      useMessagesStore.getState().markAsRead(conversationId)
    }
    set((state) => ({
      items: state.activeFilter === 'unread'
        ? state.items.filter((item) => item.scopeKey !== scopeKey)
        : state.items.map((item) => item.scopeKey === scopeKey ? { ...item, isRead: true } : item)
    }))
    await get().refreshCounts()
  },

  markAllRead: async () => {
    await window.api.db.inbox.markAllRead()
    const { useMessagesStore } = await import('./messages.store')
    for (const conversation of useMessagesStore.getState().conversations) {
      if (conversation.unreadCount > 0) useMessagesStore.getState().markAsRead(conversation.id)
    }
    set((state) => ({
      counts: [],
      items: state.activeFilter === 'unread'
        ? []
        : state.items.map((item) => ({ ...item, isRead: true }))
    }))
  },

  setPreference: async (scopeKey, mode) => {
    await window.api.db.inbox.setPreference(scopeKey, mode)
    set((state) => ({ preferences: { ...state.preferences, [scopeKey]: mode } }))
    await Promise.all([get().refreshCounts(), get().load()])
  }
}))
