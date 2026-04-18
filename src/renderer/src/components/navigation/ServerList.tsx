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

  const activeServerId = location.pathname.match(/^\/channels\/(?!@me)(.+)/)?.[1] || null

  return (
    <>
      <div className="flex flex-col items-center gap-2 w-full">
        {servers.map((server) => {
          const isActive = activeServerId === server.id
          return (
            <Tooltip key={server.id} content={server.name} side="right">
              <div className="relative flex items-center justify-center w-full group">
                {isActive ? (
                  <motion.div
                    layoutId="server-pill"
                    className="absolute left-0 w-1 rounded-r-md bg-white opacity-100"
                    initial={{ height: 8 }}
                    animate={{ height: 40 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                ) : (
                  <div className="absolute left-0 w-1 rounded-r-md bg-white opacity-0 group-hover:opacity-100 group-hover:h-5 transition-all duration-200" />
                )}
                <button
                  onClick={() => navigate(`/channels/${server.id}`)}
                  className={cn(
                    'flex items-center justify-center h-[48px] w-[48px] transition-all duration-200 font-semibold text-lg overflow-hidden',
                    isActive
                      ? 'rounded-[16px] text-white'
                      : 'rounded-[24px] text-white/90 hover:rounded-[16px] hover:text-white'
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

        <div className="w-8 h-[2px] bg-mesh-bg-tertiary mx-auto my-1 rounded-full" />

        {/* Add Server */}
        <Tooltip content="Create / Join Server" side="right">
          <div className="relative flex items-center justify-center w-full group">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center justify-center h-[48px] w-[48px] rounded-[24px] bg-mesh-bg-tertiary text-mesh-green hover:bg-mesh-green hover:text-white hover:rounded-[16px] transition-all duration-200"
            >
              <Plus className="h-6 w-6" />
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
