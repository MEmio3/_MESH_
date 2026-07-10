import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Signal,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
  Wifi
} from 'lucide-react'
import { useCallStore } from '@/stores/call.store'
import { useAudioPrefsStore } from '@/stores/audioPrefs.store'
import { registerAudioSink } from '@/stores/audioPrefs.store'
import { useNetStatsStore, pingTone } from '@/stores/netstats.store'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { VoiceDetectionRing } from '@/components/voice/VoiceDetectionRing'
import { StreamPickerModal } from '@/components/server/StreamPickerModal'
import { cn } from '@/lib/utils'

interface DeviceLists {
  mics: MediaDeviceInfo[]
  cams: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
}

function useMediaDevices(enabled: boolean): DeviceLists {
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [], speakers: [] })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        setDevices({
          mics: list.filter((d) => d.kind === 'audioinput'),
          cams: list.filter((d) => d.kind === 'videoinput'),
          speakers: list.filter((d) => d.kind === 'audiooutput')
        })
      } catch {
        /* ignore */
      }
    }
    refresh()
    navigator.mediaDevices.addEventListener?.('devicechange', refresh)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh)
    }
  }, [enabled])
  return devices
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [active])
  return now
}

function callQualityLabel(rtt: number | null): string {
  if (rtt === null) return 'Waiting'
  if (rtt < 80) return 'Excellent'
  if (rtt < 160) return 'Stable'
  return 'Laggy'
}

function CallOverlay(): JSX.Element | null {
  const status = useCallStore((s) => s.status)
  const peerId = useCallStore((s) => s.peerId)
  const peerName = useCallStore((s) => s.peerName)
  const kind = useCallStore((s) => s.kind)
  const isMuted = useCallStore((s) => s.isMuted)
  const isCameraOn = useCallStore((s) => s.isCameraOn)
  const isScreenSharing = useCallStore((s) => s.isScreenSharing)
  const screenSourceLabel = useCallStore((s) => s.screenSourceLabel)
  const isLocalSpeaking = useCallStore((s) => s.isLocalSpeaking)
  const isRemoteSpeaking = useCallStore((s) => s.isRemoteSpeaking)
  const startedAt = useCallStore((s) => s.startedAt)
  const declineReason = useCallStore((s) => s.declineReason)
  const remoteStream = useCallStore((s) => s.remoteStream)
  const localStream = useCallStore((s) => s.localStream)
  const accept = useCallStore((s) => s.accept)
  const decline = useCallStore((s) => s.decline)
  const end = useCallStore((s) => s.end)
  const toggleMute = useCallStore((s) => s.toggleMute)
  const toggleCamera = useCallStore((s) => s.toggleCamera)
  const startScreenShareFromSource = useCallStore((s) => s.startScreenShareFromSource)
  const stopScreenShare = useCallStore((s) => s.stopScreenShare)

  // Mic + speaker come from the global audio prefs (same selection used in
  // UserPanel); camera stays call-local because it is only relevant in-call.
  const micDeviceId = useAudioPrefsStore((s) => s.inputDeviceId)
  const speakerDeviceId = useAudioPrefsStore((s) => s.outputDeviceId)
  const setMicDevice = useAudioPrefsStore((s) => s.setInputDevice)
  const setSpeakerDevice = useAudioPrefsStore((s) => s.setOutputDevice)
  const cameraDeviceId = useCallStore((s) => s.cameraDeviceId)
  const setCameraDevice = useCallStore((s) => s.setCameraDevice)

  const [showSettings, setShowSettings] = useState(false)
  const [sharePickerOpen, setSharePickerOpen] = useState(false)
  const [stageExpanded, setStageExpanded] = useState(false)
  const devices = useMediaDevices(showSettings)
  const peerRtt = useNetStatsStore((s) => s.rttMs)

  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)

  const now = useTicker(status === 'active')

  useEffect(() => {
    if (remoteStream && audioRef.current) {
      audioRef.current.srcObject = remoteStream
      audioRef.current.play().catch(() => {})
    }
    if (remoteStream && videoRef.current) {
      videoRef.current.srcObject = remoteStream
      videoRef.current.play().catch(() => {})
    }
  }, [remoteStream])

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream
      localVideoRef.current.play().catch(() => {})
    }
  }, [localStream])

  useEffect(() => registerAudioSink(audioRef.current, peerId), [remoteStream, peerId])

  useEffect(() => {
    if (status !== 'active') setSharePickerOpen(false)
  }, [status])

  useEffect(() => {
    if (status !== 'active') setStageExpanded(false)
  }, [status])

  if (status === 'idle' || !peerId) return null

  const duration = startedAt ? now - startedAt : 0
  const hasRemoteVideo = !!remoteStream && remoteStream.getVideoTracks().some((t) => t.enabled && !t.muted)
  const hasLocalVideo = !!localStream && localStream.getVideoTracks().some((t) => t.enabled && !t.muted)
  const hasLocalVideoSource = isCameraOn || isScreenSharing
  const showVideoSurface = status === 'active' && kind === 'video'
  const showRemoteVideo = showVideoSurface && hasRemoteVideo
  const callTypeLabel = kind === 'video' ? 'Direct Video' : 'Direct Voice'
  const qualityLabel = callQualityLabel(peerRtt)
  const showMediaStage = status === 'active' && (kind === 'video' || hasRemoteVideo || hasLocalVideoSource)
  const stageTitle = showRemoteVideo
    ? peerName || peerId
    : hasLocalVideoSource
      ? isScreenSharing
        ? screenSourceLabel || 'Screen share'
        : 'Camera preview'
      : peerName || peerId

  if (status === 'incoming' || status === 'outgoing' || status === 'declined') {
    const title =
      status === 'incoming'
        ? `Incoming ${kind} call`
        : status === 'outgoing'
          ? `Calling ${peerName}...`
          : 'Call ended'
    const Icon = status === 'incoming' ? PhoneIncoming : PhoneOutgoing

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-md">
        <div className="mesh-reveal-in mesh-shimmer relative w-full max-w-[380px] overflow-hidden rounded-2xl border border-mesh-border/70 bg-mesh-bg-secondary/95 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="absolute inset-x-10 -top-24 h-44 rounded-full bg-mesh-green/15 blur-3xl" />
          <div className="relative flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-mesh-text-muted">
            <Icon className="h-3.5 w-3.5 text-mesh-green" />
            {title}
          </div>

          <div className="relative mt-6 flex flex-col items-center">
            <div className="relative isolate rounded-full bg-mesh-bg-tertiary p-1">
              {status !== 'declined' && <VoiceDetectionRing size="lg" bars={status === 'incoming'} />}
              <UserAvatar userId={peerId} fallback={peerName || peerId} size="xl" status={status === 'declined' ? 'dnd' : 'online'} />
            </div>
            <div className="mt-4 max-w-full truncate text-xl font-bold text-mesh-text-primary">
              {peerName || peerId}
            </div>
            <div className="mt-1 flex items-center gap-1.5 rounded-full border border-mesh-border/70 bg-mesh-bg-primary/70 px-3 py-1 text-[11px] font-semibold text-mesh-text-muted">
              <Wifi className="h-3 w-3 text-mesh-green" />
              {callTypeLabel}
            </div>
          </div>

          {status === 'incoming' && (
            <div className="relative mt-7 grid grid-cols-2 gap-3">
              <button
                onClick={decline}
                className="mesh-pressable mesh-icon-button mesh-icon-phone flex h-12 items-center justify-center gap-2 rounded-full border border-mesh-danger/35 bg-mesh-danger text-sm font-bold text-white shadow-[0_14px_32px_rgba(229,72,77,0.30)] transition hover:opacity-90"
                title="Decline"
              >
                <PhoneOff className="h-5 w-5" />
                Decline
              </button>
              <button
                onClick={accept}
                className="mesh-pressable mesh-icon-button mesh-icon-phone flex h-12 items-center justify-center gap-2 rounded-full border border-mesh-green/35 bg-mesh-green text-sm font-bold text-white shadow-[0_14px_32px_rgba(35,165,89,0.34)] transition hover:bg-mesh-green-light"
                title="Accept call"
              >
                <PhoneIncoming className="h-5 w-5" />
                Accept
              </button>
            </div>
          )}

          {status === 'outgoing' && (
            <button
              onClick={() => end(true)}
              className="mesh-pressable mesh-icon-button mesh-icon-phone relative mx-auto mt-7 flex h-11 items-center gap-2 rounded-full bg-mesh-danger px-5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(229,72,77,0.24)] transition hover:opacity-90"
            >
              <PhoneOff className="h-4 w-4" />
              Cancel
            </button>
          )}

          {status === 'declined' && (
            <p className="relative mt-5 text-center text-xs leading-relaxed text-mesh-text-muted">
              {declineReason ?? 'The call was declined.'}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 text-mesh-text-primary">
      {showMediaStage && (
        <section
          className={cn(
            'pointer-events-auto mesh-reveal-in absolute overflow-hidden border border-mesh-border/70 bg-black/90 shadow-[0_28px_90px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl',
            stageExpanded
              ? 'inset-4 rounded-2xl'
              : 'right-5 top-16 h-[min(430px,calc(100vh-168px))] w-[min(760px,calc(100vw-2rem))] rounded-2xl'
          )}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(45,212,191,0.13),transparent_34%),radial-gradient(circle_at_88%_0%,rgba(96,165,250,0.10),transparent_32%)]" />
          <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/75 to-transparent px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                {isScreenSharing ? <ScreenShare className="h-3.5 w-3.5 text-mesh-green" /> : kind === 'video' ? <Video className="h-3.5 w-3.5 text-mesh-green" /> : <Volume2 className="h-3.5 w-3.5 text-mesh-green" />}
                <span className="max-w-[24rem] truncate">{stageTitle}</span>
              </span>
              <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white/75 sm:inline-flex">
                <Signal className="h-3.5 w-3.5 text-mesh-green" />
                {qualityLabel}
              </span>
            </div>
            <button
              onClick={() => setStageExpanded((v) => !v)}
              className="mesh-pressable grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/50 text-white/80 transition hover:bg-white/10 hover:text-white"
              title={stageExpanded ? 'Exit full screen' : 'Full screen'}
            >
              {stageExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </header>

          <div className="relative flex h-full w-full items-center justify-center">
            {showRemoteVideo ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full bg-black object-contain"
              />
            ) : hasLocalVideoSource && hasLocalVideo ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={cn('h-full w-full bg-black object-contain', isCameraOn && !isScreenSharing && '-scale-x-100')}
              />
            ) : (
              <div className="relative flex h-full w-full flex-col items-center justify-center p-6 text-center">
                <div className="absolute inset-x-1/4 top-1/2 h-48 -translate-y-1/2 rounded-full bg-mesh-green/12 blur-3xl" />
                <div className={cn('relative isolate rounded-full bg-mesh-bg-tertiary p-1.5', isRemoteSpeaking && 'mesh-speaking-ring')}>
                  {isRemoteSpeaking && <VoiceDetectionRing size="lg" />}
                  <UserAvatar userId={peerId} fallback={peerName || peerId} size="xl" status="online" />
                </div>
                <h2 className="relative mt-5 max-w-full truncate text-2xl font-bold text-mesh-text-primary">
                  {peerName || peerId}
                </h2>
                <p className="relative mt-2 text-xs text-mesh-text-muted">
                  {kind === 'video' ? 'Waiting for video' : 'Voice connected'}
                </p>
              </div>
            )}

            {showRemoteVideo && hasLocalVideoSource && hasLocalVideo && (
              <div className="mesh-hover-lift absolute bottom-4 right-4 aspect-video w-44 overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_18px_46px_rgba(0,0,0,0.35)]">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={cn('h-full w-full object-cover', isCameraOn && !isScreenSharing && '-scale-x-100')}
                />
                <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {isScreenSharing ? (screenSourceLabel || 'Screen') : 'You'}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="pointer-events-auto absolute left-1/2 top-4 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-mesh-border/70 bg-mesh-bg-primary/80 px-3 py-2 shadow-[0_18px_54px_rgba(0,0,0,0.34)] backdrop-blur-xl">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-mesh-green/25 bg-mesh-green/12 text-mesh-green">
          {kind === 'video' ? <Video className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </div>
        <div className="min-w-0 pr-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-mesh-text-primary">{callTypeLabel}</span>
            <span className="rounded-full border border-mesh-green/25 bg-mesh-green/10 px-2 py-0.5 text-[10px] font-bold uppercase text-mesh-green">
              Connected
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-mesh-text-muted">
            <span className="font-mono">{formatDuration(duration)}</span>
            <span className="h-1 w-1 rounded-full bg-mesh-text-muted/60" />
            <span className={cn('font-mono', peerRtt !== null && pingTone(peerRtt))}>
              {peerRtt !== null ? `${peerRtt} ms` : 'ping --'}
            </span>
          </div>
        </div>
      </div>

      {showSettings && (
        <DevicePanel
          devices={devices}
          micDeviceId={micDeviceId}
          speakerDeviceId={speakerDeviceId}
          cameraDeviceId={cameraDeviceId}
          setMicDevice={setMicDevice}
          setSpeakerDevice={setSpeakerDevice}
          setCameraDevice={setCameraDevice}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="pointer-events-auto absolute bottom-5 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-mesh-border/70 bg-mesh-bg-primary/88 p-2 shadow-[0_22px_70px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
        <div className="mr-1 hidden min-w-0 items-center gap-2 border-r border-mesh-border/60 px-2 pr-4 sm:flex">
          <div className={cn('relative isolate rounded-full bg-mesh-bg-tertiary p-0.5', isRemoteSpeaking && 'mesh-speaking-ring')}>
            {isRemoteSpeaking && <VoiceDetectionRing size="sm" bars={false} />}
            <UserAvatar userId={peerId} fallback={peerName || peerId} size="md" status="online" />
          </div>
          <div className="min-w-0">
            <div className="max-w-36 truncate text-sm font-semibold text-mesh-text-primary">{peerName || peerId}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mesh-text-muted">
              <Sparkles className="h-3 w-3 text-mesh-green" />
              {qualityLabel}
            </div>
          </div>
        </div>

        <CallControlButton
          title="Audio and video devices"
          iconMotion="settings"
          active={showSettings}
          onClick={() => setShowSettings((v) => !v)}
        >
          <Settings className="h-5 w-5" />
        </CallControlButton>
        <CallControlButton
          title={isMuted ? 'Unmute' : 'Mute'}
          iconMotion="mic"
          danger={isMuted}
          onClick={toggleMute}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </CallControlButton>
        <CallControlButton
          title={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
          iconMotion="video"
          active={isCameraOn}
          onClick={() => toggleCamera()}
        >
          {isCameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </CallControlButton>
        <CallControlButton
          title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
          iconMotion="video"
          active={isScreenSharing}
          onClick={() => {
            if (isScreenSharing) stopScreenShare()
            else setSharePickerOpen(true)
          }}
        >
          {isScreenSharing ? <ScreenShareOff className="h-5 w-5" /> : <ScreenShare className="h-5 w-5" />}
        </CallControlButton>
        <CallControlButton
          title="End call"
          iconMotion="phone"
          danger
          wide
          onClick={() => end(true)}
        >
          <PhoneOff className="h-5 w-5" />
          <span>Leave</span>
        </CallControlButton>
      </div>

      <audio ref={audioRef} autoPlay className="hidden" />
      <StreamPickerModal
        isOpen={sharePickerOpen}
        onClose={() => setSharePickerOpen(false)}
        initialTab="screens"
        title="Share in call"
        onShare={startScreenShareFromSource}
      />
    </div>
  )
}

function CallControlButton({
  title,
  iconMotion,
  active,
  danger,
  wide,
  onClick,
  children
}: {
  title: string
  iconMotion: 'settings' | 'mic' | 'video' | 'phone'
  active?: boolean
  danger?: boolean
  wide?: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'mesh-pressable mesh-icon-button flex h-12 items-center justify-center rounded-full text-sm font-semibold transition-colors',
        `mesh-icon-${iconMotion}`,
        wide ? 'min-w-24 gap-2 px-5' : 'w-12',
        danger
          ? 'bg-mesh-danger text-white shadow-[0_14px_32px_rgba(229,72,77,0.24)] hover:opacity-90'
          : active
            ? 'bg-mesh-green text-white shadow-[0_14px_32px_rgba(35,165,89,0.22)] hover:bg-mesh-green-light'
            : 'bg-mesh-bg-tertiary text-mesh-text-primary hover:bg-mesh-bg-elevated'
      )}
      title={title}
    >
      {children}
    </button>
  )
}

function DevicePanel({
  devices,
  micDeviceId,
  speakerDeviceId,
  cameraDeviceId,
  setMicDevice,
  setSpeakerDevice,
  setCameraDevice,
  onClose
}: {
  devices: DeviceLists
  micDeviceId: string | null
  speakerDeviceId: string | null
  cameraDeviceId: string | null
  setMicDevice: (deviceId: string | null) => void
  setSpeakerDevice: (deviceId: string | null) => void
  setCameraDevice: (deviceId: string | null) => void
  onClose: () => void
}): JSX.Element {
  return (
    <div className="mesh-reveal-in absolute bottom-[76px] right-5 z-10 flex w-[390px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-mesh-border/70 bg-mesh-bg-secondary/98 p-4 shadow-[0_28px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-mesh-text-muted">Audio and video</span>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-mesh-text-muted transition-colors hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
        >
          Close
        </button>
      </div>
      <DeviceSelect
        icon={<Mic className="h-3 w-3" />}
        label="Microphone"
        value={micDeviceId || ''}
        onChange={(value) => setMicDevice(value || null)}
        fallback="System default"
        devices={devices.mics}
        emptyLabel="Mic"
      />
      <DeviceSelect
        icon={<Volume2 className="h-3 w-3" />}
        label="Speaker"
        value={speakerDeviceId || ''}
        onChange={(value) => setSpeakerDevice(value || null)}
        fallback="System default"
        devices={devices.speakers}
        emptyLabel="Speaker"
      />
      <DeviceSelect
        icon={<Video className="h-3 w-3" />}
        label="Camera"
        value={cameraDeviceId || ''}
        onChange={(value) => setCameraDevice(value || null)}
        fallback="System default"
        devices={devices.cams}
        emptyLabel="Camera"
      />
      {devices.speakers.length === 0 && (
        <p className="text-[10px] leading-snug text-mesh-text-muted">
          Speaker selection may be unavailable in this environment.
        </p>
      )}
    </div>
  )
}

function DeviceSelect({
  icon,
  label,
  value,
  onChange,
  fallback,
  devices,
  emptyLabel
}: {
  icon: ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  fallback: string
  devices: MediaDeviceInfo[]
  emptyLabel: string
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mesh-text-secondary">
        {icon}
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-mesh-border bg-mesh-bg-tertiary px-2 text-sm text-mesh-text-primary outline-none transition-colors focus:border-mesh-green"
      >
        <option value="">{fallback}</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${emptyLabel} ${d.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
    </label>
  )
}

export { CallOverlay }
