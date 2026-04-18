import { Mic, MicOff, Headphones, HeadphoneOff, Settings, PhoneOff, Wifi, Monitor, Camera, CameraOff, ChevronUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/Tooltip'
import { useVoiceStore } from '@/stores/voice.store'
import { useServersStore } from '@/stores/servers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { AudioDevicePopover } from '@/components/audio/AudioDevicePopover'

/**
 * Discord-style persistent voice status bar. Renders above the user panel
 * whenever the user is connected to a voice room, no matter which text
 * channel / page they're viewing. Gives them a one-click way to hang up
 * without navigating back to the voice room.
 *
 * Now rendered in AppShell spanning the full left section width
 * (activity bar + sidebar).
 */
function VoiceConnectionBar(): JSX.Element | null {
  const navigate = useNavigate()
  const { isConnected, currentServerId, isScreenSharing, isCameraOn, leaveRoom, openPicker, stopStream } = useVoiceStore()
  const handleShareToggle = (): void => {
    if (isScreenSharing) stopStream()
    else openPicker('applications')
  }
  const handleCameraToggle = (): void => {
    if (isCameraOn) stopStream()
    else openPicker('camera')
  }
  const server = useServersStore((s) =>
    currentServerId ? s.servers.find((sv) => sv.id === currentServerId) : undefined
  )

  if (!isConnected) return null

  const roomLabel = server?.voiceRoomName ?? 'Voice Room'
  const serverLabel = server?.name ?? 'Voice'

  return (
    <div className="relative shrink-0 border-b border-[#1e1f22] bg-[#111214] flex flex-col pt-2 pb-2.5 px-2 gap-1.5">
      {/* Top row — status label + disconnect */}
      <div className="flex items-center justify-between px-1">
        <button
          onClick={() => currentServerId && navigate(`/channels/${currentServerId}`)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left rounded hover:bg-white/[0.06] px-1 py-0.5 transition-colors"
          title="Return to voice channel"
        >
          <div className="text-[#23a559] shrink-0">
            <Wifi className="h-[18px] w-[18px]" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-[#23a559] leading-tight">
              Voice Connected
            </span>
            <span className="text-[11px] text-[#949ba4] truncate leading-tight mt-0.5">
              {roomLabel} / {serverLabel}
            </span>
          </div>
        </button>

        <Tooltip content="Disconnect" side="top">
          <button
            onClick={leaveRoom}
            className="flex items-center justify-center h-8 w-8 rounded text-[#b5bac1] hover:text-[#dbdee1] hover:bg-white/[0.06] transition-colors shrink-0 ml-1"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>

      {/* Bottom row — media controls */}
      <div className="grid grid-cols-2 gap-1.5 px-1 mt-0.5 w-full">
        <VoiceBarControl
          tooltip={isScreenSharing ? 'Stop Sharing' : 'Share Your Screen'}
          active={isScreenSharing}
          onClick={handleShareToggle}
        >
          <Monitor className="h-[18px] w-[18px]" />
        </VoiceBarControl>

        <VoiceBarControl
          tooltip={isCameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
          active={isCameraOn}
          onClick={handleCameraToggle}
        >
          {isCameraOn ? <Camera className="h-[18px] w-[18px]" /> : <CameraOff className="h-[18px] w-[18px]" />}
        </VoiceBarControl>
      </div>
    </div>
  )
}

/** Small control button used inside VoiceConnectionBar */
function VoiceBarControl({ tooltip, active, onClick, children }: {
  tooltip: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <Tooltip content={tooltip} side="top">
      <button
        onClick={onClick}
        className={cn(
          'flex items-center justify-center h-[32px] w-full rounded-md transition-colors',
          active
            ? 'bg-white/20 text-white hover:bg-white/30'
            : 'bg-[#2b2d31] text-[#b5bac1] hover:bg-[#313338] hover:text-[#dbdee1]'
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/**
 * Bottom user info panel with avatar, name, and control buttons.
 * Rendered in AppShell spanning the full left section width.
 */
function UserPanel(): JSX.Element {
  const navigate = useNavigate()
  const { isMuted, isDeafened, toggleMute, toggleDeafen } = useVoiceStore()
  const identity = useIdentityStore((s) => s.identity)
  const selfAvatar = useAvatarStore((s) => s.self)
  const uploadSelf = useAvatarStore((s) => s.uploadSelf)
  const [uploading, setUploading] = useState(false)

  // Device-picker popover state (Discord-style chevron next to mic/headphone).
  const [popover, setPopover] = useState<'input' | 'output' | null>(null)
  const micAnchorRef = useRef<HTMLDivElement>(null)
  const outAnchorRef = useRef<HTMLDivElement>(null)

  const username = identity?.username || 'User'
  const avatarColor = identity?.avatarPath || '#107C10'

  const handleAvatarClick = async (): Promise<void> => {
    if (uploading) return
    setUploading(true)
    try {
      await uploadSelf()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-1 h-[53px] px-2 bg-[#232428] shrink-0">
      {/* User Info — clickable area */}
      <div className="flex items-center gap-2 flex-1 min-w-0 rounded-md px-1 py-1 hover:bg-white/[0.06] transition-colors cursor-pointer group">
        {/* Avatar with status indicator — click to upload */}
        <Tooltip content="Change avatar" side="top">
          <button
            onClick={handleAvatarClick}
            disabled={uploading}
            className="relative inline-flex shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-mesh-green"
          >
            {selfAvatar ? (
              <img
                src={selfAvatar}
                alt={username}
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white select-none"
                style={{ backgroundColor: avatarColor }}
              >
                {username.charAt(0).toUpperCase()}
              </div>
            )}
            {/* Camera overlay on hover */}
            <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="h-3.5 w-3.5 text-white" />
            </div>
            {/* Online status dot */}
            <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-[#23a559] border-[3px] border-[#232428] group-hover:border-[#2b2d31] transition-colors box-content" />
          </button>
        </Tooltip>

        {/* Username + status */}
        <div className="flex flex-col min-w-0 -gap-0.5">
          <span className="text-[13px] font-semibold text-[#f2f3f5] truncate leading-tight mt-0.5">
            {username}
          </span>
          <span className="text-[11px] text-[#b5bac1] truncate leading-tight">
            Online
          </span>
        </div>
      </div>

      {/* Control buttons */}
      <div className="flex items-center shrink-0">
        {/* Mic button + device-picker chevron */}
        <div ref={micAnchorRef} className="flex items-center">
          <UserPanelButton
            tooltip={isMuted ? 'Unmute' : 'Mute'}
            active={isMuted}
            onClick={toggleMute}
          >
            {isMuted ? <MicOff className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
          </UserPanelButton>
          <Tooltip content="Input device" side="top">
            <button
              onClick={() => setPopover((p) => (p === 'input' ? null : 'input'))}
              className={cn(
                'flex items-center justify-center h-8 w-4 rounded-md transition-colors -ml-0.5',
                popover === 'input'
                  ? 'text-white bg-white/[0.06]'
                  : 'text-[#b5bac1] hover:text-[#dbdee1] hover:bg-white/[0.06]'
              )}
            >
              <ChevronUp className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>

        {/* Headphone button + output device-picker chevron */}
        <div ref={outAnchorRef} className="flex items-center">
          <UserPanelButton
            tooltip={isDeafened ? 'Undeafen' : 'Deafen'}
            active={isDeafened}
            onClick={toggleDeafen}
          >
            {isDeafened ? <HeadphoneOff className="h-[18px] w-[18px]" /> : <Headphones className="h-[18px] w-[18px]" />}
          </UserPanelButton>
          <Tooltip content="Output device" side="top">
            <button
              onClick={() => setPopover((p) => (p === 'output' ? null : 'output'))}
              className={cn(
                'flex items-center justify-center h-8 w-4 rounded-md transition-colors -ml-0.5',
                popover === 'output'
                  ? 'text-white bg-white/[0.06]'
                  : 'text-[#b5bac1] hover:text-[#dbdee1] hover:bg-white/[0.06]'
              )}
            >
              <ChevronUp className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>

        <UserPanelButton
          tooltip="User Settings"
          onClick={() => navigate('/settings')}
        >
          <Settings className="h-[18px] w-[18px]" />
        </UserPanelButton>
      </div>

      <AudioDevicePopover
        kind="input"
        anchorRef={micAnchorRef}
        open={popover === 'input'}
        onClose={() => setPopover(null)}
      />
      <AudioDevicePopover
        kind="output"
        anchorRef={outAnchorRef}
        open={popover === 'output'}
        onClose={() => setPopover(null)}
      />
    </div>
  )
}

interface UserPanelButtonProps {
  tooltip: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}

function UserPanelButton({ tooltip, active, onClick, children }: UserPanelButtonProps): JSX.Element {
  return (
    <Tooltip content={tooltip} side="top">
      <button
        onClick={onClick}
        className={cn(
          'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
          active
            ? 'text-[#da373c] hover:bg-white/[0.06]'
            : 'text-[#b5bac1] hover:bg-white/[0.06] hover:text-[#dbdee1]'
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export { VoiceConnectionBar, UserPanel }
