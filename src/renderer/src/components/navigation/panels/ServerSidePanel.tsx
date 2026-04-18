import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useServersStore } from '@/stores/servers.store'
import type { ServerMember } from '@/types/server'
import { useIdentityStore } from '@/stores/identity.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'
import { ChannelTree } from '@/components/server/ChannelTree'

interface ServerSidePanelProps {
  serverId: string
}

// Stable empty reference so selectors that fall back to [] don't produce a
// fresh array on every render — Zustand would treat it as a new snapshot and
// trigger an endless re-render loop / "getSnapshot should be cached" warning.
const EMPTY_MEMBERS: ServerMember[] = []

function ServerSidePanel({ serverId }: ServerSidePanelProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const servers = useServersStore((s) => s.servers)
  const leaveServer = useServersStore((s) => s.leaveServer)
  const members = useServersStore((s) => s.serverMembers[serverId]) || EMPTY_MEMBERS
  const identity = useIdentityStore((s) => s.identity)
  const serverAvatars = useServerAvatarStore((s) => s.byServer)
  const uploadServerAvatar = useServerAvatarStore((s) => s.uploadForServer)
  const clearServerAvatar = useServerAvatarStore((s) => s.clearForServer)

  const [showDropdown, setShowDropdown] = useState(false)
  const [copiedLocal, setCopiedLocal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Parse active channel id out of the URL (route pattern: /channels/:id[/:channelId]).
  const activeChannelId = location.pathname.match(/^\/channels\/[^/]+\/(.+)$/)?.[1] ?? null
  void identity

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const server = servers.find((s) => s.id === serverId)
  const serverAvatar = serverAvatars[serverId]
  const canManageServer = server?.role === 'host' || server?.role === 'moderator'

  if (!server) {
    return (
      <div className="p-4">
        <span className="text-sm text-mesh-text-muted">Server not found</span>
      </div>
    )
  }

  const onlineMembers = members.filter((m) => m.status !== 'offline')

  return (
    <div className="flex flex-col h-full">
      {/* Server Header — slightly taller for breathing room, icon gets a subtle ring and
          hover-bg lifts to tertiary. Chevron rotates on open. */}
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className={cn(
            'w-full flex items-center gap-2.5 h-[50px] px-3.5 border-b border-mesh-border/40 transition-colors',
            showDropdown ? 'bg-mesh-bg-tertiary/60' : 'hover:bg-mesh-bg-tertiary/40'
          )}
        >
          <div
            className="h-7 w-7 rounded-md overflow-hidden flex items-center justify-center text-xs font-bold text-white shrink-0 ring-1 ring-black/20 shadow-sm"
            style={serverAvatar ? undefined : { backgroundColor: server.iconColor }}
          >
            {serverAvatar ? (
              <img src={serverAvatar} alt={server.name} className="h-full w-full object-cover" draggable={false} />
            ) : (
              server.name[0].toUpperCase()
            )}
          </div>
          <span className="text-[13px] font-bold text-mesh-text-primary truncate flex-1 text-left tracking-tight">
            {server.name}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-mesh-text-muted shrink-0 transition-transform duration-200',
              showDropdown && 'rotate-180 text-mesh-text-secondary'
            )}
          />
        </button>

        {showDropdown && (
          <div className="absolute top-full left-2 right-2 mt-1 bg-mesh-bg-elevated border border-mesh-border/50 rounded-lg shadow-xl py-1 z-50 animate-in fade-in-0 zoom-in-95 duration-100">
            <button
              onClick={() => {
                navigator.clipboard.writeText(server.id)
                setCopiedLocal(true)
                setTimeout(() => setCopiedLocal(false), 2000)
              }}
              className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-mesh-text-primary hover:bg-mesh-green hover:text-white rounded-sm transition-colors"
              style={{ width: 'calc(100% - 8px)' }}
            >
              {copiedLocal ? 'Copied!' : 'Copy Server ID'}
            </button>
            {canManageServer && (
              <>
                <div className="h-px bg-mesh-border/50 my-1 mx-2" />
                <button
                  onClick={async () => {
                    setShowDropdown(false)
                    await uploadServerAvatar(serverId)
                  }}
                  className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-mesh-text-primary hover:bg-mesh-green hover:text-white rounded-sm transition-colors"
                  style={{ width: 'calc(100% - 8px)' }}
                >
                  {serverAvatar ? 'Change Server Icon' : 'Upload Server Icon'}
                </button>
                {serverAvatar && (
                  <button
                    onClick={() => {
                      setShowDropdown(false)
                      clearServerAvatar(serverId)
                    }}
                    className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-mesh-text-primary hover:bg-mesh-bg-tertiary rounded-sm transition-colors"
                    style={{ width: 'calc(100% - 8px)' }}
                  >
                    Remove Icon
                  </button>
                )}
              </>
            )}
            <div className="h-px bg-mesh-border/50 my-1 mx-2" />
            <button
              onClick={() => {
                setShowConfirmModal(true)
                setShowDropdown(false)
              }}
              className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-red-400 hover:bg-red-500 hover:text-white rounded-sm transition-colors"
              style={{ width: 'calc(100% - 8px)' }}
            >
              {server.role === 'host' ? 'Delete Server' : 'Leave Server'}
            </button>
          </div>
        )}
      </div>

      {/* Channels + Categories (dynamic). Context menu + hover-+ manage actions
          live inside ChannelTree, gated by canManageServer. */}
      <ChannelTree
        serverId={serverId}
        canManage={canManageServer}
        activeChannelId={activeChannelId}
        onSelectTextChannel={(channelId) => navigate(`/channels/${serverId}/${channelId}`)}
      />

      {/* Member Count — subtle top border to separate from channel tree,
          pulsing presence dot, and mono-width numbers so the count doesn't
          jitter as members come and go. */}
      <div className="px-4 py-2.5 bg-mesh-bg-primary shrink-0 border-t border-mesh-border/40">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2 w-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-mesh-green/60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-mesh-green" />
          </span>
          <span className="text-[11px] font-medium text-mesh-text-muted tabular-nums tracking-wide">
            <span className="text-mesh-text-secondary">{onlineMembers.length}</span> Online
            <span className="mx-1.5 text-mesh-text-muted/60">·</span>
            <span className="text-mesh-text-secondary">{members.length}</span> Total
          </span>
        </div>
      </div>

      {/* Confirm Modal */}
      <Modal isOpen={showConfirmModal} onClose={() => setShowConfirmModal(false)} title={server.role === 'host' ? 'Delete Server' : 'Leave Server'}>
        <div className="p-1">
          <p className="text-sm text-mesh-text-secondary mb-6">
            {server.role === 'host' 
              ? `Delete "${server.name}"? This removes the server for everyone. This cannot be undone.`
              : `Leave "${server.name}"? You'll lose access to all channels in this server.`}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>
              Cancel
            </Button>
            <Button 
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => {
                if (leaveServer) leaveServer(server.id, server.role === 'host')
                setShowConfirmModal(false)
                navigate('/channels/@me')
              }}
            >
              {server.role === 'host' ? 'Delete Server' : 'Leave Server'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export { ServerSidePanel }
