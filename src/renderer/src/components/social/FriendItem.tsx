import { useNavigate } from 'react-router-dom'
import { MessageSquare, Phone, Video } from 'lucide-react'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { Tooltip } from '@/components/ui/Tooltip'
import { ContextMenu, type ContextMenuEntry } from '@/components/ui/ContextMenu'
import type { Friend } from '@/types/social'
import { useFriendsStore } from '@/stores/friends.store'
import { useLiveStatus } from '@/lib/useLiveStatus'

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
  const status = useLiveStatus(friend.userId, friend.status)

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
        className="mesh-hover-lift group mx-2 my-1 flex h-16 cursor-pointer items-center rounded-xl border border-transparent px-3 transition-all hover:border-mesh-border/60 hover:bg-mesh-bg-tertiary/45 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      >
        {/* Avatar */}
        <UserAvatar
          userId={friend.userId}
          fallback={friend.username}
          size="md"
          status={status}
        />

        {/* Info */}
        <div className="flex-1 min-w-0 ml-3">
          <span className="block truncate text-sm font-semibold text-mesh-text-primary">
            {friend.username}
          </span>
          <span className="block truncate text-xs text-mesh-text-muted">
            {statusLabels[status]}
          </span>
        </div>

        {/* Action Buttons — visible on hover */}
        <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip content="Message" side="top">
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/channels/@me/dm_${friend.userId}`)
              }}
              className="mesh-pressable grid h-9 w-9 place-items-center rounded-xl border border-mesh-border/60 bg-mesh-bg-secondary text-mesh-text-secondary transition-colors hover:bg-mesh-green hover:text-white"
            >
              <MessageSquare className="h-4.5 w-4.5" />
            </button>
          </Tooltip>
          <Tooltip content="Voice Call" side="top">
            <button
              onClick={(e) => e.stopPropagation()}
              className="mesh-pressable mesh-icon-button mesh-icon-phone grid h-9 w-9 place-items-center rounded-xl border border-mesh-border/60 bg-mesh-bg-secondary text-mesh-text-secondary transition-colors hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
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
