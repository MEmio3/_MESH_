import { useNavigate, useLocation } from 'react-router-dom'
import { Home } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/Tooltip'
import { Separator } from '@/components/ui/Separator'
import { ServerList } from './ServerList'

function ActivityBar(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  const isHome = location.pathname.startsWith('/channels/@me')

  return (
    <div className="flex flex-col items-center w-[60px] shrink-0 h-full bg-mesh-bg-primary py-2.5 border-r border-mesh-border/60">
      {/* Home Button */}
      <ActivityBarItem
        tooltip="Home"
        isActive={isHome}
        onClick={() => navigate('/channels/@me')}
        hasNotification={false}
      >
        <Home className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </ActivityBarItem>

      <div className="w-7 h-px bg-mesh-border mx-auto my-2.5" />

      {/* Server List — from store with create/join modal */}
      <div className="flex flex-col items-center gap-2 flex-1 w-full overflow-y-auto scrollbar-none">
        <ServerList />
      </div>

    </div>
  )
}

interface ActivityBarItemProps {
  tooltip: string
  isActive: boolean
  onClick: () => void
  hasNotification?: boolean
  children: React.ReactNode
}

function ActivityBarItem({ tooltip, isActive, onClick, hasNotification, children }: ActivityBarItemProps): JSX.Element {
  return (
    <Tooltip content={tooltip} side="right">
      <div className="relative flex items-center justify-center w-full group">
        {/* Active indicator — a hairline accent bar. No shape morphing,
            no color flooding: the state reads from one precise element. */}
        {isActive ? (
          <motion.div
            layoutId="activity-pill"
            className="absolute left-0 w-[2px] rounded-r-full bg-mesh-green"
            initial={{ height: 8 }}
            animate={{ height: 24 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        ) : (
          <div className="absolute left-0 w-[2px] rounded-r-full bg-mesh-text-muted opacity-0 h-0 group-hover:opacity-100 group-hover:h-3 transition-all duration-150" />
        )}

        <div className="relative">
          <button
            onClick={onClick}
            className={cn(
              'flex items-center justify-center h-10 w-10 rounded-lg transition-colors duration-150 overflow-hidden',
              isActive
                ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
                : 'bg-transparent text-mesh-text-muted hover:bg-mesh-bg-secondary hover:text-mesh-text-secondary'
            )}
          >
            {children}
          </button>

          {hasNotification && !isActive && (
            <div className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-mesh-danger border-2 border-mesh-bg-primary" />
          )}
        </div>
      </div>
    </Tooltip>
  )
}

export { ActivityBar }
