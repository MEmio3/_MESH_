import { Phone, Pin, Search, UserRound, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { Tooltip } from '@/components/ui/Tooltip'
import { useCallStore } from '@/stores/call.store'
import { useLiveStatus } from '@/lib/useLiveStatus'
import type { Conversation } from '@/types/messages'

interface ChatHeaderProps {
  conversation: Conversation
  profileOpen?: boolean
  onToggleProfile?: () => void
  toolMode?: 'search' | 'pins' | null
  onOpenTools?: (mode: 'search' | 'pins') => void
}

function ChatHeader({ conversation, profileOpen, onToggleProfile, toolMode, onOpenTools }: ChatHeaderProps): JSX.Element {
  const startOutgoing = useCallStore((s) => s.startOutgoing)
  const status = useLiveStatus(conversation.recipientId, 'offline')
  return (
    <div className="flex items-center justify-between h-12 px-4 border-b border-mesh-border/50 shrink-0">
      {/* Left: user info */}
      <div className="flex items-center gap-2.5 min-w-0">
        <UserAvatar
          userId={conversation.recipientId}
          fallback={conversation.recipientName}
          size="sm"
          status={status}
        />
        <div className="min-w-0">
          <span className="text-sm font-semibold text-mesh-text-primary block truncate">
            {conversation.recipientName}
          </span>
        </div>
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-1">
        <Tooltip content="Voice Call" side="bottom">
          <button
            onClick={() => startOutgoing(conversation.recipientId, conversation.recipientName, 'voice')}
            className="mesh-icon-button mesh-icon-phone h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors"
          >
            <Phone className="h-4.5 w-4.5" />
          </button>
        </Tooltip>
        <Tooltip content="Video Call" side="bottom">
          <button
            onClick={() => startOutgoing(conversation.recipientId, conversation.recipientName, 'video')}
            className="mesh-icon-button mesh-icon-video h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors"
          >
            <Video className="h-4.5 w-4.5" />
          </button>
        </Tooltip>
        <Tooltip content="Search" side="bottom">
          <button
            onClick={() => onOpenTools?.('search')}
            className={cn(
              'mesh-icon-button mesh-icon-search h-8 w-8 rounded-md flex items-center justify-center transition-colors',
              toolMode === 'search' ? 'bg-mesh-bg-tertiary text-mesh-text-primary' : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary'
            )}
          >
            <Search className="h-4.5 w-4.5" />
          </button>
        </Tooltip>
        <Tooltip content="Pinned Messages" side="bottom">
          <button
            onClick={() => onOpenTools?.('pins')}
            className={cn(
              'mesh-icon-button h-8 w-8 rounded-md flex items-center justify-center transition-colors',
              toolMode === 'pins' ? 'bg-mesh-bg-tertiary text-mesh-green' : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary'
            )}
          >
            <Pin className="h-4.5 w-4.5" />
          </button>
        </Tooltip>
        {onToggleProfile && (
          <Tooltip content={profileOpen ? 'Hide Profile' : 'Show Profile'} side="bottom">
            <button
              onClick={onToggleProfile}
              className={cn(
                'mesh-icon-button mesh-icon-users h-8 w-8 rounded-md flex items-center justify-center transition-colors',
                profileOpen
                  ? 'text-mesh-text-primary bg-mesh-bg-tertiary'
                  : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary'
              )}
            >
              <UserRound className="h-4.5 w-4.5" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

export { ChatHeader }
