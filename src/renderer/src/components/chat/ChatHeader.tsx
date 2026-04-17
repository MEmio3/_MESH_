import { Phone, Video, Search } from 'lucide-react'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Conversation } from '@/types/messages'

interface ChatHeaderProps {
  conversation: Conversation
}

function ChatHeader({ conversation }: ChatHeaderProps): JSX.Element {
  return (
    <div className="flex items-center justify-between h-12 px-4 border-b border-mesh-border/50 shrink-0">
      {/* Left: user info */}
      <div className="flex items-center gap-2.5 min-w-0">
        <UserAvatar
          userId={conversation.recipientId}
          fallback={conversation.recipientName}
          size="sm"
          status={conversation.recipientStatus}
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
            onClick={() => window.api.signaling.emit('call-invite', conversation.recipientId, { kind: 'voice' })}
            className="h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors"
          >
            <Phone className="h-4.5 w-4.5" />
          </button>
        </Tooltip>
        <Tooltip content="Video Call" side="bottom">
          <button
            onClick={() => window.api.signaling.emit('call-invite', conversation.recipientId, { kind: 'video' })}
            className="h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors"
          >
            <Video className="h-4.5 w-4.5" />
          </button>
        </Tooltip>
        <Tooltip content="Search" side="bottom">
          <button className="h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors">
            <Search className="h-4.5 w-4.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export { ChatHeader }
