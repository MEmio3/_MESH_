import { Mic, MicOff, Headphones, HeadphoneOff, Settings, PhoneOff, Wifi, Monitor, Camera, CameraOff, ChevronUp, Moon, EyeOff, Circle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/Tooltip'
import { useVoiceStore } from '@/stores/voice.store'
import { useServersStore } from '@/stores/servers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { useStatusStore } from '@/stores/status.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useNetStatsStore, formatKbps, pingTone } from '@/stores/netstats.store'
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
  const rttMs = useNetStatsStore((s) => s.rttMs)
  const upKbps = useNetStatsStore((s) => s.upKbps)
  const downKbps = useNetStatsStore((s) => s.downKbps)

  if (!isConnected) return null

  const roomLabel = server?.voiceRoomName ?? 'Voice Room'
  const serverLabel = server?.name ?? 'Voice'

  return (
    <div className="relative shrink-0 border-b border-mesh-border bg-mesh-bg-primary flex flex-col pt-2 pb-2.5 px-2 gap-1.5">
      {/* Top row — status label + disconnect */}
      <div className="flex items-center justify-between px-1">
        <button
          onClick={() => currentServerId && navigate(`/channels/${currentServerId}`)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left rounded hover:bg-white/[0.06] px-1 py-0.5 transition-colors"
          title="Return to voice channel"
        >
          <div className={cn('shrink-0', pingTone(rttMs))}>
            <Wifi className="h-[18px] w-[18px]" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-mesh-green leading-tight flex items-center gap-1.5">
              Voice Connected
              {rttMs !== null && (
                <span className={cn('text-[10px] font-mono font-medium leading-none', pingTone(rttMs))}>
                  {rttMs} ms
                </span>
              )}
            </span>
            <span className="text-[11px] text-mesh-text-secondary truncate leading-tight mt-0.5">
              {roomLabel} / {serverLabel}
            </span>
            {/* Live throughput on the local line — most useful while streaming */}
            {(upKbps > 0 || downKbps > 0) && (
              <span className="text-[10px] font-mono text-mesh-text-muted truncate leading-tight mt-0.5">
                ↑ {formatKbps(upKbps)} · ↓ {formatKbps(downKbps)}
              </span>
            )}
          </div>
        </button>

        <Tooltip content="Disconnect" side="top">
          <button
            onClick={leaveRoom}
            className="flex items-center justify-center h-8 w-8 rounded text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-white/[0.06] transition-colors shrink-0 ml-1"
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

/** One row in the status-switcher popover. */
function StatusOption({ icon, label, active, onClick }: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors',
        active
          ? 'text-mesh-text-primary bg-mesh-bg-tertiary'
          : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary'
      )}
    >
      <span className="shrink-0 inline-flex w-4 justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-mesh-green shrink-0" />}
    </button>
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
            : 'bg-mesh-bg-tertiary text-mesh-text-secondary hover:bg-mesh-bg-hover hover:text-mesh-text-primary'
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

  // Status switcher — click the name/status area to change presence.
  const selfStatus = useStatusStore((s) => s.self)
  const chooseStatus = useStatusStore((s) => s.chooseStatus)
  const applyInvisibleChange = useStatusStore((s) => s.applyInvisibleChange)
  const invisibleMode = useSettingsStore((s) => s.privacy.invisibleMode)
  const updatePrivacy = useSettingsStore((s) => s.updatePrivacy)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!statusMenuOpen) return
    const close = (e: MouseEvent): void => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [statusMenuOpen])

  const statusLabel = invisibleMode ? 'Invisible' : selfStatus === 'idle' ? 'Idle' : 'Online'
  const statusDotClass = invisibleMode
    ? 'bg-[#80848e]'
    : selfStatus === 'idle'
      ? 'bg-[#f0b232]'
      : 'bg-[#23a559]'

  const pickStatus = (kind: 'online' | 'idle' | 'invisible'): void => {
    if (kind === 'invisible') {
      updatePrivacy({ invisibleMode: true })
      applyInvisibleChange()
    } else {
      // Zustand set() is synchronous, so publishSelf inside chooseStatus
      // reads the already-updated invisible flag.
      if (invisibleMode) updatePrivacy({ invisibleMode: false })
      chooseStatus(kind)
    }
    setStatusMenuOpen(false)
  }

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
    <div className="flex items-center gap-1 h-[54px] px-2 bg-mesh-bg-secondary shrink-0 border-t border-mesh-border shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {/* User Info — clickable area */}
      <div className="flex items-center gap-2 flex-1 min-w-0 rounded-md px-1.5 py-1 hover:bg-white/[0.06] transition-colors cursor-pointer group">
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
            {/* Status dot — reflects the actual chosen presence */}
            <span className={cn(
              'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-mesh-bg-secondary group-hover:border-mesh-bg-tertiary transition-colors box-content',
              statusDotClass
            )} />
          </button>
        </Tooltip>

        {/* Username + status — click to change presence */}
        <div ref={statusMenuRef} className="relative flex flex-col min-w-0 -gap-0.5 flex-1">
          <button
            onClick={() => setStatusMenuOpen((v) => !v)}
            className="flex flex-col min-w-0 text-left focus:outline-none"
            title="Set status"
          >
            <span className="text-[13px] font-semibold text-mesh-text-primary truncate leading-tight mt-0.5">
              {username}
            </span>
            <span className="text-[11px] text-mesh-text-secondary truncate leading-tight">
              {statusLabel}
            </span>
          </button>

          {statusMenuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-44 rounded-lg bg-mesh-bg-elevated border border-mesh-border shadow-2xl py-1.5 z-[130]">
              <StatusOption
                icon={<Circle className="h-3 w-3 fill-[#23a559] text-[#23a559]" />}
                label="Online"
                active={!invisibleMode && selfStatus === 'online'}
                onClick={() => pickStatus('online')}
              />
              <StatusOption
                icon={<Moon className="h-3.5 w-3.5 text-[#f0b232]" />}
                label="Idle"
                active={!invisibleMode && selfStatus === 'idle'}
                onClick={() => pickStatus('idle')}
              />
              <StatusOption
                icon={<EyeOff className="h-3.5 w-3.5 text-[#80848e]" />}
                label="Invisible"
                active={invisibleMode}
                onClick={() => pickStatus('invisible')}
              />
              <p className="px-3 pt-1.5 pb-0.5 text-[10px] leading-snug text-mesh-text-muted">
                Invisible: you appear offline to everyone but keep receiving everything.
              </p>
            </div>
          )}
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
                  : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-white/[0.06]'
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
                  : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-white/[0.06]'
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
            ? 'text-mesh-danger hover:bg-white/[0.06]'
            : 'text-mesh-text-secondary hover:bg-white/[0.06] hover:text-mesh-text-primary'
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export { VoiceConnectionBar, UserPanel }
