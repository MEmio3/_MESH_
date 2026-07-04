import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/Tooltip'
import { useServersStore } from '@/stores/servers.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'
import { CreateServerModal } from '@/components/modals/CreateServerModal'

function ServerList(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const servers = useServersStore((s) => s.servers)
  const avatars = useServerAvatarStore((s) => s.byServer)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const activeServerId = location.pathname.match(/^\/channels\/(?!@me)([^/]+)/)?.[1] || null

  return (
    <>
      <div className="flex flex-col items-center gap-1.5 w-full">
        {servers.map((server) => {
          const isActive = activeServerId === server.id
          return (
            <Tooltip key={server.id} content={server.name} side="right">
              <div className="relative flex items-center justify-center w-full group">
                {isActive ? (
                  <motion.div
                    layoutId="server-pill"
                    className="absolute left-0 w-[2px] rounded-r-full bg-mesh-green"
                    initial={{ height: 8 }}
                    animate={{ height: 24 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                ) : (
                  <div className="absolute left-0 w-[2px] rounded-r-full bg-mesh-text-muted opacity-0 h-0 group-hover:opacity-100 group-hover:h-3 transition-all duration-150" />
                )}
                <button
                  onClick={() => navigate(`/channels/${server.id}`)}
                  className={cn(
                    'flex items-center justify-center h-10 w-10 rounded-lg transition-all duration-150 font-semibold text-sm overflow-hidden border',
                    isActive
                      ? 'border-mesh-border-light text-white opacity-100'
                      : 'border-transparent text-white/85 opacity-80 hover:opacity-100 hover:text-white'
                  )}
                  style={avatars[server.id] ? undefined : { backgroundColor: server.iconColor }}
                >
                  {avatars[server.id] ? (
                    <img
                      src={avatars[server.id]}
                      alt={server.name}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    server.name[0].toUpperCase()
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
              className="flex items-center justify-center h-10 w-10 rounded-lg border border-dashed border-mesh-border-light text-mesh-text-muted hover:text-mesh-green hover:border-mesh-green/50 hover:bg-mesh-bg-secondary transition-colors duration-150"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} />
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
