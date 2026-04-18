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
    <div className="flex flex-col items-center w-[72px] shrink-0 h-full bg-mesh-bg-primary py-3">
      {/* Home Button */}
      <ActivityBarItem
        tooltip="Home"
        isActive={isHome}
        onClick={() => navigate('/channels/@me')}
        hasNotification={false}
      >
        <Home className="h-6 w-6" />
      </ActivityBarItem>

      <div className="w-8 h-[2px] bg-mesh-border/60 mx-auto my-2.5 rounded-full" />

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
        {/* Interaction Pill — active pill grows to 40px, hover pill to 20px.
            Pill is pure white and tapers with a rounded right edge. */}
        {isActive ? (
          <motion.div
            layoutId="activity-pill"
            className="absolute left-0 w-[3px] rounded-r-full bg-white opacity-100"
            initial={{ height: 8 }}
            animate={{ height: 40 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        ) : (
          <div className="absolute left-0 w-[3px] rounded-r-full bg-white opacity-0 h-0 group-hover:opacity-100 group-hover:h-5 transition-all duration-200" />
        )}

        <div className="relative">
          <button
            onClick={onClick}
            className={cn(
              'flex items-center justify-center h-[48px] w-[48px] transition-all duration-200 overflow-hidden',
              isActive
                ? 'rounded-[16px] bg-mesh-green text-white'
                : 'rounded-[24px] bg-mesh-bg-tertiary text-mesh-text-primary hover:bg-mesh-green hover:text-white hover:rounded-[16px]'
            )}
          >
            {children}
          </button>
          
          {hasNotification && !isActive && (
            <div className="absolute top-0 -right-1 h-3.5 w-3.5 rounded-full bg-mesh-danger border-[3px] border-mesh-bg-primary" />
          )}
        </div>
      </div>
    </Tooltip>
  )
}

export { ActivityBar }
