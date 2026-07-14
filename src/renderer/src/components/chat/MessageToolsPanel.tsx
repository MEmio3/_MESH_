import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Code2,
  FileText,
  Image,
  Link2,
  LoaderCircle,
  MessageSquare,
  Pin,
  PinOff,
  Search,
  UserRound,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { Message, MessageSearchKind, MessageSearchOptions } from '@/types/messages'

export type MessageToolsMode = 'search' | 'pins'

interface MessageToolsPanelProps {
  mode: MessageToolsMode
  scopeLabel: string
  liveMessages: Message[]
  canPin: boolean
  onModeChange: (mode: MessageToolsMode) => void
  onClose: () => void
  onSearch: (options: MessageSearchOptions) => Promise<Message[]>
  onLoadPinned: () => Promise<Message[]>
  onJump: (message: Message) => Promise<void> | void
  onTogglePin: (messageId: string, pinned: boolean) => Promise<void> | void
}

const kindOptions: Array<{ value: MessageSearchKind; label: string }> = [
  { value: 'all', label: 'All messages' },
  { value: 'files', label: 'Files' },
  { value: 'images', label: 'Images' },
  { value: 'links', label: 'Links' },
  { value: 'code', label: 'Code' }
]

function messagePreview(message: Message): string {
  if (message.file) return message.file.fileName
  if (message.content.startsWith('data:image/')) return 'Image attachment'
  return message.content.replace(/```\w*\n?/g, '').replace(/```/g, '').replace(/\s+/g, ' ').trim() || 'Empty message'
}

function ResultKindIcon({ message }: { message: Message }): JSX.Element {
  if (message.file?.fileType.startsWith('image/') || message.content.startsWith('data:image/')) {
    return <Image className="h-3.5 w-3.5" />
  }
  if (message.file) return <FileText className="h-3.5 w-3.5" />
  if (message.content.includes('```')) return <Code2 className="h-3.5 w-3.5" />
  if (/https?:\/\//i.test(message.content)) return <Link2 className="h-3.5 w-3.5" />
  return <MessageSquare className="h-3.5 w-3.5" />
}

function MessageToolsPanel({
  mode,
  scopeLabel,
  liveMessages,
  canPin,
  onModeChange,
  onClose,
  onSearch,
  onLoadPinned,
  onJump,
  onTogglePin
}: MessageToolsPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [kind, setKind] = useState<MessageSearchKind>('all')
  const [date, setDate] = useState('')
  const [results, setResults] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const pinSignature = useMemo(
    () => liveMessages.filter((message) => message.isPinned).map((message) => message.id).sort().join('|'),
    [liveMessages]
  )

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const dayStart = date ? new Date(`${date}T00:00:00`).getTime() : undefined
        const dayEnd = date ? new Date(`${date}T23:59:59.999`).getTime() : undefined
        const next = mode === 'pins'
          ? await onLoadPinned()
          : await onSearch({ query, author, kind, after: dayStart, before: dayEnd, limit: 150 })
        if (!cancelled) setResults(next)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, mode === 'search' ? 220 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [author, date, kind, mode, onLoadPinned, onSearch, pinSignature, query])

  useEffect(() => {
    if (liveMessages.length === 0) return
    const pinById = new Map(liveMessages.map((message) => [message.id, !!message.isPinned]))
    setResults((current) => current.map((message) =>
      pinById.has(message.id) ? { ...message, isPinned: pinById.get(message.id) } : message
    ))
  }, [liveMessages])

  const togglePin = async (message: Message): Promise<void> => {
    const pinned = !message.isPinned
    await onTogglePin(message.id, pinned)
    setResults((current) => mode === 'pins' && !pinned
      ? current.filter((item) => item.id !== message.id)
      : current.map((item) => item.id === message.id ? { ...item, isPinned: pinned } : item))
  }

  return (
    <aside className="mesh-reveal-in flex h-full w-[360px] shrink-0 flex-col border-l border-mesh-border/65 bg-mesh-bg-secondary/95">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-mesh-border/60 px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-mesh-text-primary">
            {mode === 'search' ? 'Search Messages' : 'Pinned Messages'}
          </p>
          <p className="truncate text-[10px] text-mesh-text-muted">{scopeLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mesh-icon-button grid h-8 w-8 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
          title="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-mesh-border/55 p-3">
        <div className="grid grid-cols-2 rounded-md border border-mesh-border/60 bg-mesh-bg-primary/45 p-0.5">
          <button
            type="button"
            onClick={() => onModeChange('search')}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors',
              mode === 'search' ? 'bg-mesh-bg-tertiary text-mesh-text-primary shadow-sm' : 'text-mesh-text-muted hover:text-mesh-text-primary'
            )}
          >
            <Search className="h-3.5 w-3.5" />
            Search
          </button>
          <button
            type="button"
            onClick={() => onModeChange('pins')}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors',
              mode === 'pins' ? 'bg-mesh-bg-tertiary text-mesh-text-primary shadow-sm' : 'text-mesh-text-muted hover:text-mesh-text-primary'
            )}
          >
            <Pin className="h-3.5 w-3.5" />
            Pinned
          </button>
        </div>

        {mode === 'search' && (
          <div className="mt-3 space-y-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mesh-text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search messages"
                className="h-9 w-full rounded-md border border-mesh-border/65 bg-mesh-bg-primary/55 pl-8 pr-3 text-sm text-mesh-text-primary outline-none transition focus:border-mesh-green/70 focus:ring-1 focus:ring-mesh-green/25"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="relative">
                <UserRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mesh-text-muted" />
                <input
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  placeholder="From user"
                  className="h-8 w-full rounded-md border border-mesh-border/60 bg-mesh-bg-primary/45 pl-8 pr-2 text-xs text-mesh-text-primary outline-none focus:border-mesh-green/60"
                />
              </label>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as MessageSearchKind)}
                className="h-8 rounded-md border border-mesh-border/60 bg-mesh-bg-primary/45 px-2 text-xs text-mesh-text-secondary outline-none focus:border-mesh-green/60"
              >
                {kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <label className="relative block">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mesh-text-muted" />
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-8 w-full rounded-md border border-mesh-border/60 bg-mesh-bg-primary/45 pl-8 pr-2 text-xs text-mesh-text-secondary outline-none focus:border-mesh-green/60"
                title="Filter by date"
              />
            </label>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[10px] font-semibold uppercase text-mesh-text-muted">
          <span>{mode === 'search' ? 'Results' : 'Saved in this conversation'}</span>
          <span>{loading ? 'Searching' : results.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && results.length === 0 ? (
            <div className="grid h-32 place-items-center text-mesh-text-muted">
              <LoaderCircle className="h-5 w-5 animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-6 py-14 text-center">
              {mode === 'search' ? <Search className="mx-auto h-7 w-7 text-mesh-text-muted" /> : <Pin className="mx-auto h-7 w-7 text-mesh-text-muted" />}
              <p className="mt-3 text-sm font-medium text-mesh-text-secondary">
                {mode === 'search' ? 'No matching messages' : 'No pinned messages'}
              </p>
            </div>
          ) : (
            results.map((message) => (
              <div
                key={message.id}
                role="button"
                tabIndex={0}
                onClick={() => onJump(message)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onJump(message)
                  }
                }}
                className="group border-t border-mesh-border/45 px-3 py-3 outline-none transition-colors first:border-t-0 hover:bg-mesh-bg-tertiary/45 focus:bg-mesh-bg-tertiary/45"
              >
                <div className="flex items-start gap-2.5">
                  <UserAvatar userId={message.senderId} fallback={message.senderName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-mesh-text-primary">{message.senderName}</span>
                      <span className="shrink-0 text-[9px] text-mesh-text-muted">
                        {new Date(message.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-mesh-text-secondary">
                      {messagePreview(message)}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 text-[10px] text-mesh-text-muted">
                        <ResultKindIcon message={message} />
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {canPin && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            togglePin(message)
                          }}
                          className={cn(
                            'mesh-icon-button grid h-7 w-7 place-items-center rounded-md transition-colors',
                            message.isPinned
                              ? 'text-mesh-green hover:bg-mesh-green/10'
                              : 'text-mesh-text-muted opacity-0 hover:bg-mesh-bg-elevated hover:text-mesh-text-primary group-hover:opacity-100'
                          )}
                          title={message.isPinned ? 'Unpin message' : 'Pin message'}
                        >
                          {message.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  )
}

export { MessageToolsPanel }
