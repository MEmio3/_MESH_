import type { Message } from '@/types/messages'
import { MessageBubble } from './MessageBubble'
import { useScrollAnchor } from '@/hooks/useScrollAnchor'
import { ChevronDown, MessageCircle, Sparkles } from 'lucide-react'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useServersStore } from '@/stores/servers.store'
import { useMemo } from 'react'

interface MessageFeedProps {
  messages: Message[]
  recipientName: string
  onEditMessage?: (messageId: string, newContent: string) => void
  onDeleteMessage?: (messageId: string) => void
  onToggleReaction?: (messageId: string, emojiId: string) => void
  onReply?: (msg: Message) => void
  /**
   * Predicate: can the local user delete this specific message?
   * Default is sender-only (handled inside MessageBubble).
   * Servers pass a predicate that also allows host/mod to delete any.
   */
  canDeleteMessage?: (msg: Message) => boolean
}

const GROUPING_THRESHOLD = 5 * 60 * 1000 // 5 minutes

function formatDateDivider(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  if (isToday) return 'Today'
  if (isYesterday) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function shouldShowDateDivider(current: Message, previous: Message | undefined): boolean {
  if (!previous) return true
  const curDate = new Date(current.timestamp).toDateString()
  const prevDate = new Date(previous.timestamp).toDateString()
  return curDate !== prevDate
}

function isGrouped(current: Message, previous: Message | undefined): boolean {
  if (!previous) return false
  if (current.senderId !== previous.senderId) return false
  if (current.timestamp - previous.timestamp > GROUPING_THRESHOLD) return false
  // If there's a date divider between them, don't group
  if (new Date(current.timestamp).toDateString() !== new Date(previous.timestamp).toDateString()) return false
  return true
}

function resolveMessagesWithNames(messages: Message[], namesByUserId: Map<string, string>): Message[] {
  return messages.map((message) => {
    const resolved = namesByUserId.get(message.senderId)
    if (!resolved || resolved === message.senderName) return message
    return { ...message, senderName: resolved }
  })
}

function MessageFeed({ messages, recipientName: _recipientName, onEditMessage, onDeleteMessage, onToggleReaction, onReply, canDeleteMessage }: MessageFeedProps): JSX.Element {
  const { containerRef, isAtBottom, scrollToBottom } = useScrollAnchor()
  const identity = useIdentityStore((s) => s.identity)
  const friends = useFriendsStore((s) => s.friends)
  const serverMembers = useServersStore((s) => s.serverMembers)
  const myId = identity?.userId
  const namesByUserId = useMemo(() => {
    const names = new Map<string, string>()
    if (identity) names.set(identity.userId, identity.username)
    for (const friend of friends) names.set(friend.userId, friend.username)
    for (const members of Object.values(serverMembers)) {
      for (const member of members) names.set(member.userId, member.username)
    }
    return names
  }, [identity, friends, serverMembers])
  const displayMessages = useMemo(
    () => resolveMessagesWithNames(messages, namesByUserId),
    [messages, namesByUserId]
  )

  if (displayMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="mesh-reveal-in mesh-shimmer relative w-full max-w-sm overflow-hidden rounded-2xl border border-mesh-border/70 bg-mesh-bg-secondary/80 p-6 text-center shadow-[0_18px_48px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="absolute inset-x-8 -top-20 h-32 rounded-full bg-mesh-green/15 blur-3xl" />
          <div className="relative mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-mesh-border/70 bg-mesh-bg-tertiary text-mesh-green shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <MessageCircle className="h-7 w-7 stroke-1.5" />
          </div>
          <h3 className="relative text-lg font-semibold text-mesh-text-primary">No messages yet</h3>
          <p className="relative mx-auto mt-1 max-w-xs text-sm text-mesh-text-muted">
            Send the first message and this space will start filling in.
          </p>
          <div className="relative mt-4 inline-flex items-center gap-1.5 rounded-full border border-mesh-border/60 bg-mesh-bg-tertiary/60 px-3 py-1 text-xs text-mesh-text-secondary">
            <Sparkles className="h-3.5 w-3.5 text-mesh-green" />
            Private conversation
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto pb-3"
      >
        {displayMessages.map((msg, i) => {
          const prev = i > 0 ? displayMessages[i - 1] : undefined
          const showDate = shouldShowDateDivider(msg, prev)
          const grouped = isGrouped(msg, prev)

          return (
            <div key={msg.id}>
              {/* Date divider */}
              {showDate && (
                <div className="relative my-3 flex items-center justify-center px-4 py-2">
                  <div className="absolute left-4 right-4 h-px bg-gradient-to-r from-transparent via-mesh-border to-transparent" />
                  <span className="relative z-10 rounded-full border border-mesh-border/60 bg-mesh-bg-secondary px-3 py-1 text-[11px] font-semibold leading-none text-mesh-text-muted shadow-sm">
                    {formatDateDivider(msg.timestamp)}
                  </span>
                </div>
              )}

              <MessageBubble
                message={msg}
                isGrouped={grouped}
                isOwnMessage={msg.senderId === myId}
                onEdit={onEditMessage}
                onDelete={onDeleteMessage}
                onToggleReaction={onToggleReaction}
                onReply={onReply}
                canDelete={canDeleteMessage ? canDeleteMessage(msg) : undefined}
              />
            </div>
          )
        })}
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="mesh-pressable absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 animate-in items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-mesh-green px-4 py-2 text-white shadow-[0_14px_36px_rgba(35,165,89,0.32)] transition-all hover:bg-mesh-green-light"
        >
          <span className="text-xs font-semibold">Jump to present</span>
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export { MessageFeed }
