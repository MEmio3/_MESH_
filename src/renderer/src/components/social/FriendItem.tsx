import { useNavigate } from 'react-router-dom'
import { MessageSquare, Phone, Video, MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Tooltip } from '@/components/ui/Tooltip'
import { ContextMenu, type ContextMenuEntry } from '@/components/ui/ContextMenu'
import type { Friend } from '@/types/social'
import { useFriendsStore } from '@/stores/friends.store'

interface FriendItemProps {
  friend: Friend
}

const statusLabels: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
}

function FriendItem({ friend }: FriendItemProps): JSX.Element {
  const navigate = useNavigate()
  const { removeFriend, blockUser } = useFriendsStore()

  const contextItems: ContextMenuEntry[] = [
    { label: 'Message', icon: <MessageSquare className="h-4 w-4" />, onClick: () => navigate(`/channels/@me/dm_${friend.userId}`) },
    { label: 'Voice Call', icon: <Phone className="h-4 w-4" />, onClick: () => {} },
    { label: 'Video Call', icon: <Video className="h-4 w-4" />, onClick: () => {} },
    { separator: true },
    { label: 'Remove Friend', onClick: () => removeFriend(friend.userId), variant: 'danger' },
    { label: 'Block', onClick: () => blockUser(friend.userId), variant: 'danger' },
  ]

  return (
    <ContextMenu items={contextItems}>
      <div
        onClick={() => navigate(`/channels/@me/dm_${friend.userId}`)}
        className="flex items-center h-16 border-t border-mesh-border px-3 hover:bg-mesh-bg-tertiary/40 rounded-lg mx-2 my-1 transition-colors group cursor-pointer"
      >
        {/* Avatar */}
        <Avatar
          fallback={friend.username}
          size="md"
          status={friend.status}
          src={null}
        />

        {/* Info */}
        <div className="flex-1 min-w-0 ml-3">
          <span className="text-base font-semibold text-mesh-text-primary block truncate">
            {friend.username}
          </span>
          <span className="text-xs text-mesh-text-muted truncate block">
            {statusLabels[friend.status]}
          </span>
        </div>

        {/* Action Buttons — visible on hover */}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip content="Message" side="top">
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/channels/@me/dm_${friend.userId}`)
              }}
              className="h-9 w-9 rounded-full flex items-center justify-center bg-mesh-bg-secondary hover:bg-mesh-bg-tertiary text-mesh-text-secondary hover:text-mesh-text-primary transition-colors"
            >
              <MessageSquare className="h-4.5 w-4.5" />
            </button>
          </Tooltip>
          <Tooltip content="Voice Call" side="top">
            <button
              onClick={(e) => e.stopPropagation()}
              className="h-9 w-9 rounded-full flex items-center justify-center bg-mesh-bg-secondary hover:bg-mesh-bg-tertiary text-mesh-text-secondary hover:text-mesh-text-primary transition-colors"
            >
              <Phone className="h-4.5 w-4.5" />
            </button>
          </Tooltip>
        </div>
      </div>
    </ContextMenu>
  )
}

export { FriendItem }
