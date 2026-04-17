import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { X } from 'lucide-react'
import type { Conversation } from '@/types/messages'

interface DmListItemProps {
  conversation: Conversation
  isActive: boolean
  onClick: () => void
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function DmListItem({ conversation, isActive, onClick }: DmListItemProps): JSX.Element {
  const lastMsg = conversation.lastMessage

  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 mx-1.5 px-2 h-11 rounded-md text-left transition-colors duration-100',
        isActive
          ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
          : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60 hover:text-mesh-text-primary'
      )}
    >
      <UserAvatar
        userId={conversation.recipientId}
        fallback={conversation.recipientName}
        size="sm"
        status={conversation.recipientStatus}
      />
      <div className="flex-1 min-w-0">
        <div className="flex flex-col">
          <span className={cn("text-sm truncate", isActive ? "text-mesh-text-primary font-medium" : "text-mesh-text-secondary group-hover:text-mesh-text-primary")}>
            {conversation.recipientName}
          </span>
          {lastMsg && (
            <p className="text-xs text-mesh-text-muted truncate">
              {lastMsg.senderName === 'You' ? `You: ${lastMsg.content}` : lastMsg.content}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center shrink-0">
        <span
          role="button"
          tabIndex={0}
          className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-mesh-text-muted hover:text-mesh-text-primary transition-opacity cursor-pointer"
          onClick={(e) => { e.stopPropagation(); /* Close logic */ }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); /* Close logic */ } }}
        >
          <X className="h-3.5 w-3.5" />
        </span>
        {conversation.unreadCount > 0 && (
          <div className="bg-mesh-green text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
            {conversation.unreadCount}
          </div>
        )}
      </div>
    </button>
  )
}

export { DmListItem }
