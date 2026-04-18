import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Hash, Volume2, ChevronDown, User, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { useServersStore } from '@/stores/servers.store'
import type { ServerMember } from '@/types/server'
import { useVoiceStore } from '@/stores/voice.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'

interface ServerSidePanelProps {
  serverId: string
}

// Stable empty reference so selectors that fall back to [] don't produce a
// fresh array on every render — Zustand would treat it as a new snapshot and
// trigger an endless re-render loop / "getSnapshot should be cached" warning.
const EMPTY_MEMBERS: ServerMember[] = []

function ServerSidePanel({ serverId }: ServerSidePanelProps): JSX.Element {
  const navigate = useNavigate()
  const servers = useServersStore((s) => s.servers)
  const leaveServer = useServersStore((s) => s.leaveServer)
  const members = useServersStore((s) => s.serverMembers[serverId]) || EMPTY_MEMBERS
  // Select each slice individually so we don't subscribe to the whole voice
  // store (which would re-render this component every tick a peer updates).
  const isConnected = useVoiceStore((s) => s.isConnected)
  const currentServerId = useVoiceStore((s) => s.currentServerId)
  const participants = useVoiceStore((s) => s.participants)
  const joinRoom = useVoiceStore((s) => s.joinRoom)
  const streamingUsers = useVoiceStore((s) => s.streamingUsers)
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)
  const serverAvatars = useServerAvatarStore((s) => s.byServer)
  const uploadServerAvatar = useServerAvatarStore((s) => s.uploadForServer)
  const clearServerAvatar = useServerAvatarStore((s) => s.clearForServer)

  const [showDropdown, setShowDropdown] = useState(false)
  const [copiedLocal, setCopiedLocal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [isTextOpen, setIsTextOpen] = useState(true)
  const [isVoiceOpen, setIsVoiceOpen] = useState(true)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
  const isVoiceHere = isConnected && currentServerId === serverId
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
      {/* Server Header */}
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="w-full flex items-center gap-2 h-12 px-4 border-b border-mesh-border/50 hover:bg-mesh-bg-tertiary/50 transition-colors"
        >
          <div
            className="h-6 w-6 rounded-md overflow-hidden flex items-center justify-center text-[11px] font-bold text-white shrink-0"
            style={serverAvatar ? undefined : { backgroundColor: server.iconColor }}
          >
            {serverAvatar ? (
              <img src={serverAvatar} alt={server.name} className="h-full w-full object-cover" draggable={false} />
            ) : (
              server.name[0].toUpperCase()
            )}
          </div>
          <span className="text-sm font-bold text-mesh-text-primary truncate flex-1 text-left">{server.name}</span>
          <ChevronDown className={cn("h-4 w-4 text-mesh-text-muted shrink-0 transition-transform duration-200", showDropdown && "rotate-180")} />
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

      {/* Channels */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 px-2 pt-3 pb-4">
          
          {/* Text Category Header */}
          <button 
            onClick={() => setIsTextOpen(!isTextOpen)}
            className="flex items-center gap-1.5 px-1 pb-1.5 w-full text-left cursor-pointer group"
          >
            <ChevronDown className={cn("h-3 w-3 text-mesh-text-muted group-hover:text-mesh-text-secondary transition-transform", !isTextOpen && "-rotate-90")} />
            <span className="text-[11px] font-semibold text-mesh-text-muted group-hover:text-mesh-text-secondary uppercase tracking-wide">
              Text Channels
            </span>
          </button>

          {/* Text Channel Item */}
          {isTextOpen && (
            <button
              onClick={() => navigate(`/channels/${serverId}`)}
              className="flex items-center gap-2 pl-6 pr-2 py-1.5 rounded-md text-left bg-mesh-bg-tertiary text-mesh-text-primary transition-colors h-8"
            >
              <Hash className="h-4 w-4 text-mesh-text-muted shrink-0" />
              <span className="text-sm truncate">{server.textChannelName}</span>
            </button>
          )}

          {/* Voice Category Header */}
          <button 
            onClick={() => setIsVoiceOpen(!isVoiceOpen)}
            className="flex items-center gap-1.5 px-1 pb-1.5 pt-4 w-full text-left cursor-pointer group"
          >
            <ChevronDown className={cn("h-3 w-3 text-mesh-text-muted group-hover:text-mesh-text-secondary transition-transform", !isVoiceOpen && "-rotate-90")} />
            <span className="text-[11px] font-semibold text-mesh-text-muted group-hover:text-mesh-text-secondary uppercase tracking-wide">
              Voice Rooms
            </span>
          </button>

          {/* Voice Channel Item */}
          {isVoiceOpen && (
            <>
              <button
                onClick={() => {
                  if (!isVoiceHere) joinRoom(serverId)
                }}
                className={cn(
                  'flex items-center gap-2 pl-6 pr-2 py-1.5 rounded-md text-left transition-colors h-8',
                  isVoiceHere
                    ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
                    : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/50 hover:text-mesh-text-primary'
                )}
              >
                <Volume2 className={cn('h-4 w-4 shrink-0', isVoiceHere ? 'text-mesh-green' : 'text-mesh-text-muted')} />
                <span className="text-sm truncate">{server.voiceRoomName}</span>
              </button>

              {/* Connected Users in Voice */}
              {isVoiceHere && participants.length > 0 && (
                <div className="flex flex-col gap-0.5 pl-10 mt-0.5">
                  {participants.map((p) => {
                    const isLive = streamingUsers.has(p.userId)
                    return (
                      <div key={p.userId} className="flex items-center gap-2 px-2 py-1 rounded text-mesh-text-secondary">
                        <Avatar fallback={p.username} size="xs" status="online" src={p.userId === selfId ? selfAvatar : avatarsByUser[p.userId]} />
                        <span className="text-xs text-mesh-text-muted truncate">{p.username}</span>
                        {isLive && (
                          <span className="ml-auto inline-flex items-center gap-1 rounded-sm bg-red-500 px-1 py-0.5 text-[9px] font-bold uppercase leading-none text-white">
                            <span className="h-1 w-1 rounded-full bg-white" />
                            Live
                          </span>
                        )}
                        {p.isMuted && !isLive && <MicOff className="h-3 w-3 text-red-400 shrink-0 ml-auto" />}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Member Count */}
      <div className="px-4 py-3 bg-mesh-bg-primary shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-mesh-green shrink-0" />
          <span className="text-xs text-mesh-text-muted">
            {onlineMembers.length} Online · {members.length} Total
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
