import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Compass, Plus, Router } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/Tooltip'
import { ServerAvatar } from '@/components/ui/ServerAvatar'
import { useServersStore } from '@/stores/servers.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'
import { CreateServerModal } from '@/components/modals/CreateServerModal'
import { meshSpring } from '@/lib/motion'
import { useInboxStore } from '@/stores/inbox.store'
import { Badge } from '@/components/ui/Badge'

function ServerList(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const servers = useServersStore((s) => s.servers)
  const avatars = useServerAvatarStore((s) => s.byServer)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const inboxCounts = useInboxStore((state) => state.counts)

  const activeServerId = location.pathname.match(/^\/channels\/(?!@me)([^/]+)/)?.[1] || null
  const isDiscover = location.pathname.startsWith('/discover')
  const isNetworkCenter = location.pathname.startsWith('/network-center')

  return (
    <>
      <div className="flex flex-col items-center gap-1.5 w-full">
        {servers.map((server) => {
          const isActive = activeServerId === server.id
          const unread = inboxCounts
            .filter((entry) => entry.serverId === server.id)
            .reduce((sum, entry) => sum + entry.unreadCount, 0)
          return (
            <Tooltip key={server.id} content={server.name} side="right">
              <div className="relative flex items-center justify-center w-full group">
                {isActive ? (
                  <motion.div
                    layoutId="server-pill"
                    className="mesh-active-indicator absolute left-0 w-[2px] rounded-r-full bg-mesh-green"
                    initial={{ height: 8 }}
                    animate={{ height: 24 }}
                    transition={meshSpring}
                  />
                ) : (
                  <div className="absolute left-0 w-[2px] rounded-r-full bg-mesh-text-muted opacity-0 h-0 group-hover:opacity-100 group-hover:h-3 transition-all duration-150" />
                )}
                <button
                  onClick={() => navigate(`/channels/${server.id}`)}
                  className={cn(
                    'mesh-pressable mesh-hover-lift flex h-10 w-10 items-center justify-center rounded-lg border p-0 transition-all duration-150',
                    isActive
                      ? 'border-mesh-green/45 opacity-100'
                      : 'border-transparent opacity-80 hover:opacity-100'
                  )}
                >
                  <ServerAvatar
                    src={avatars[server.id]}
                    name={server.name}
                    className="h-full w-full rounded-lg text-sm"
                  />
                  {!isActive && unread > 0 && (
                    <Badge count={unread} className="absolute -bottom-1 -right-1 border-2 border-mesh-bg-primary" />
                  )}
                </button>
              </div>
            </Tooltip>
          )
        })}

        <div className="w-7 h-px bg-mesh-border mx-auto my-1" />

        {/* Add Server */}
        <Tooltip content="Create / Join Server" side="right">
          <div className="relative flex items-center justify-center w-full group">
            <button
              onClick={() => setShowCreateModal(true)}
              className="mesh-pressable mesh-hover-lift flex items-center justify-center h-10 w-10 rounded-lg border border-dashed border-mesh-border-light text-mesh-text-muted hover:text-mesh-green hover:border-mesh-green/50 hover:bg-mesh-bg-secondary transition-colors duration-150"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        </Tooltip>

        <Tooltip content="Discover Networks" side="right">
          <div className="relative flex items-center justify-center w-full group">
            {isDiscover ? (
              <motion.div
                layoutId="server-pill"
                className="mesh-active-indicator absolute left-0 w-[2px] rounded-r-full bg-mesh-green"
                initial={{ height: 8 }}
                animate={{ height: 24 }}
                transition={meshSpring}
              />
            ) : (
              <div className="absolute left-0 w-[2px] rounded-r-full bg-mesh-text-muted opacity-0 h-0 group-hover:opacity-100 group-hover:h-3 transition-all duration-150" />
            )}
            <button
              onClick={() => navigate('/discover')}
              className={cn(
                'mesh-pressable mesh-hover-lift flex h-10 w-10 items-center justify-center rounded-lg border transition-colors duration-150',
                isDiscover
                  ? 'border-mesh-green/45 bg-mesh-green/12 text-mesh-green'
                  : 'border-transparent text-mesh-text-muted hover:border-mesh-border/70 hover:bg-mesh-bg-secondary hover:text-mesh-text-primary'
              )}
            >
              <Compass className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        </Tooltip>

        <Tooltip content="Network Center" side="right">
          <div className="relative flex items-center justify-center w-full group">
            {isNetworkCenter ? (
              <motion.div
                layoutId="server-pill"
                className="mesh-active-indicator absolute left-0 w-[2px] rounded-r-full bg-mesh-green"
                initial={{ height: 8 }}
                animate={{ height: 24 }}
                transition={meshSpring}
              />
            ) : (
              <div className="absolute left-0 w-[2px] rounded-r-full bg-mesh-text-muted opacity-0 h-0 group-hover:opacity-100 group-hover:h-3 transition-all duration-150" />
            )}
            <button
              onClick={() => navigate('/network-center')}
              className={cn(
                'mesh-pressable mesh-hover-lift flex h-10 w-10 items-center justify-center rounded-lg border transition-colors duration-150',
                isNetworkCenter
                  ? 'border-mesh-green/45 bg-mesh-green/12 text-mesh-green'
                  : 'border-transparent text-mesh-text-muted hover:border-mesh-border/70 hover:bg-mesh-bg-secondary hover:text-mesh-text-primary'
              )}
            >
              <Router className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        </Tooltip>
      </div>

      <CreateServerModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </>
  )
}

export { ServerList }
