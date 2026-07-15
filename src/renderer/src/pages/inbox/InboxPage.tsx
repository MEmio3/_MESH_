import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AtSign,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Hash,
  Inbox,
  MessageSquareReply,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useInboxStore, type InboxItem } from '@/stores/inbox.store'
import type { InboxFilter, InboxNotificationMode } from '../../../../shared/types'

type SourceFilter = 'all' | 'dm' | 'server'

const tabs: Array<{ id: InboxFilter; label: string; icon: typeof Inbox }> = [
  { id: 'unread', label: 'Unread', icon: Inbox },
  { id: 'mentions', label: 'Mentions', icon: AtSign },
  { id: 'replies', label: 'Replies', icon: MessageSquareReply }
]

function itemRoute(item: InboxItem): string | null {
  if (item.sourceType === 'dm' && item.conversationId) {
    return `/channels/@me/${item.conversationId}?message=${encodeURIComponent(item.messageId)}`
  }
  if (item.sourceType === 'server' && item.serverId) {
    const base = item.channelId
      ? `/channels/${item.serverId}/${item.channelId}`
      : `/channels/${item.serverId}`
    return `${base}?message=${encodeURIComponent(item.messageId)}`
  }
  return null
}

function preview(item: InboxItem): string {
  if (item.fileName) return item.fileName
  return item.content.replace(/```\w*\n?/g, '').replace(/```/g, '').replace(/\s+/g, ' ').trim() || 'Empty message'
}

function InboxPage(): JSX.Element {
  const navigate = useNavigate()
  const items = useInboxStore((state) => state.items)
  const counts = useInboxStore((state) => state.counts)
  const preferences = useInboxStore((state) => state.preferences)
  const activeFilter = useInboxStore((state) => state.activeFilter)
  const isLoading = useInboxStore((state) => state.isLoading)
  const load = useInboxStore((state) => state.load)
  const markMessageRead = useInboxStore((state) => state.markMessageRead)
  const markScopeRead = useInboxStore((state) => state.markScopeRead)
  const markAllRead = useInboxStore((state) => state.markAllRead)
  const setPreference = useInboxStore((state) => state.setPreference)
  const [source, setSource] = useState<SourceFilter>('all')

  useEffect(() => { void load() }, [load])

  const visibleItems = useMemo(
    () => source === 'all' ? items : items.filter((item) => item.sourceType === source),
    [items, source]
  )
  const unreadTotal = counts.reduce((sum, entry) => sum + entry.unreadCount, 0)
  const mentionTotal = counts.reduce((sum, entry) => sum + entry.mentionCount, 0)
  const replyTotal = counts.reduce((sum, entry) => sum + entry.replyCount, 0)

  const openItem = async (item: InboxItem): Promise<void> => {
    const route = itemRoute(item)
    if (!route) return
    await markMessageRead(item.messageId)
    navigate(route)
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-mesh-bg-primary">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-mesh-border/60 bg-mesh-bg-secondary/45 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-mesh-green/25 bg-mesh-green/10 text-mesh-green">
            <Inbox className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-mesh-text-primary">Inbox</h1>
            <p className="text-xs text-mesh-text-muted">
              {unreadTotal === 0 ? 'You are caught up' : `${unreadTotal} unread across your mesh`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load(activeFilter)}
            className="mesh-icon-button grid h-8 w-8 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
            title="Refresh inbox"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unreadTotal === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-mesh-border/65 bg-mesh-bg-tertiary px-3 text-xs font-medium text-mesh-text-secondary transition-colors hover:text-mesh-text-primary disabled:cursor-default disabled:opacity-40"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </button>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-mesh-border/50 px-5 py-2.5">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const count = tab.id === 'unread' ? unreadTotal : tab.id === 'mentions' ? mentionTotal : replyTotal
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => void load(tab.id)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                  activeFilter === tab.id
                    ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
                    : 'text-mesh-text-muted hover:bg-mesh-bg-secondary hover:text-mesh-text-primary'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {count > 0 && (
                  <span className="min-w-4 rounded-full bg-mesh-green/15 px-1 text-center text-[10px] font-bold text-mesh-green">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="flex rounded-md border border-mesh-border/60 bg-mesh-bg-secondary p-0.5">
          {(['all', 'dm', 'server'] as SourceFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSource(value)}
              className={cn(
                'h-7 rounded px-2.5 text-[11px] font-medium capitalize transition-colors',
                source === value ? 'bg-mesh-bg-tertiary text-mesh-text-primary' : 'text-mesh-text-muted hover:text-mesh-text-secondary'
              )}
            >
              {value === 'dm' ? 'DMs' : value}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && visibleItems.length === 0 ? (
          <div className="grid h-full place-items-center text-mesh-text-muted">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="grid h-full min-h-72 place-items-center px-6 text-center">
            <div>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl border border-mesh-border/60 bg-mesh-bg-secondary text-mesh-text-muted">
                <CheckCheck className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-sm font-semibold text-mesh-text-primary">Nothing waiting here</h2>
              <p className="mt-1 text-xs text-mesh-text-muted">
                {activeFilter === 'unread' ? 'New activity will appear as messages arrive.' : `Your ${activeFilter} will collect here.`}
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl px-5 py-3">
            {visibleItems.map((item) => {
              const mode = preferences[item.scopeKey] ?? 'all'
              return (
                <article
                  key={item.messageId}
                  className={cn(
                    'group relative flex gap-3 border-b border-mesh-border/45 px-2 py-3 transition-colors hover:bg-mesh-bg-secondary/45',
                    !item.isRead && 'before:absolute before:left-0 before:top-5 before:h-2 before:w-0.5 before:rounded-r before:bg-mesh-green'
                  )}
                >
                  <button type="button" onClick={() => void openItem(item)} className="flex min-w-0 flex-1 gap-3 text-left">
                    <UserAvatar userId={item.senderId} fallback={item.senderName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-sm font-semibold text-mesh-text-primary">{item.senderName}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-mesh-text-muted">
                          {item.sourceType === 'server' ? <Hash className="h-3 w-3" /> : <Bell className="h-3 w-3" />}
                          {item.sourceName}{item.channelName ? ` / ${item.channelName}` : ''}
                        </span>
                        <time className="ml-auto shrink-0 text-[10px] text-mesh-text-muted">
                          {new Date(item.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </div>
                      <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-mesh-text-secondary">{preview(item)}</p>
                      <div className="mt-2 flex items-center gap-1.5">
                        {item.isMention && <span className="rounded bg-mesh-green/12 px-1.5 py-0.5 text-[9px] font-semibold text-mesh-green">Mention</span>}
                        {item.isReply && <span className="rounded bg-mesh-info/12 px-1.5 py-0.5 text-[9px] font-semibold text-mesh-info">Reply</span>}
                        {item.fileName && <span className="truncate text-[10px] text-mesh-text-muted">Attachment</span>}
                      </div>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1 self-center opacity-70 transition-opacity group-hover:opacity-100">
                    <select
                      value={mode}
                      onChange={(event) => void setPreference(item.scopeKey, event.target.value as InboxNotificationMode)}
                      className="h-7 max-w-28 rounded-md border border-mesh-border/55 bg-mesh-bg-tertiary px-2 text-[10px] text-mesh-text-secondary outline-none focus:border-mesh-green/55"
                      title="Notifications for this conversation"
                    >
                      <option value="all">All activity</option>
                      {item.sourceType === 'server' && <option value="mentions">Mentions only</option>}
                      <option value="muted">Muted</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void markScopeRead(item.scopeKey)}
                      className="mesh-icon-button grid h-7 w-7 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-green"
                      title="Mark this conversation read"
                    >
                      {mode === 'muted' ? <BellOff className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export { InboxPage }
