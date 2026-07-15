import { Inbox, Users } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DmList } from '@/components/dm/DmList'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { useInboxStore } from '@/stores/inbox.store'

function HomeSidePanel(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const unread = useInboxStore((state) => state.counts.reduce((sum, entry) => sum + entry.unreadCount, 0))
  const isInbox = location.pathname === '/channels/@me/inbox'

  return (
    <div className="flex flex-col">
      <div className="space-y-1 border-b border-mesh-border/50 p-2">
        <button
          type="button"
          onClick={() => navigate('/channels/@me')}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors',
            !isInbox ? 'bg-mesh-bg-tertiary text-mesh-text-primary' : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60 hover:text-mesh-text-primary'
          )}
        >
          <Users className="h-4 w-4" />
          Friends
        </button>
        <button
          type="button"
          onClick={() => navigate('/channels/@me/inbox')}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors',
            isInbox ? 'bg-mesh-bg-tertiary text-mesh-text-primary' : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60 hover:text-mesh-text-primary'
          )}
        >
          <Inbox className="h-4 w-4" />
          <span className="flex-1 text-left">Inbox</span>
          <Badge count={unread} />
        </button>
      </div>
      <DmList />
    </div>
  )
}

export { HomeSidePanel }
