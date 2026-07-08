import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Mic,
  MicOff,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Settings,
  Signal,
  Sparkles,
  UserRound,
  Video,
  VideoOff,
  Volume2,
  Wifi
} from 'lucide-react'
import { useCallStore } from '@/stores/call.store'
import { useAudioPrefsStore } from '@/stores/audioPrefs.store'
import { registerAudioSink } from '@/stores/audioPrefs.store'
import { useNetStatsStore, pingTone } from '@/stores/netstats.store'
import { useIdentityStore } from '@/stores/identity.store'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { VoiceDetectionRing } from '@/components/voice/VoiceDetectionRing'
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
  const isLocalSpeaking = useCallStore((s) => s.isLocalSpeaking)
  const isRemoteSpeaking = useCallStore((s) => s.isRemoteSpeaking)
  const startedAt = useCallStore((s) => s.startedAt)
  const remoteStream = useCallStore((s) => s.remoteStream)
  const localStream = useCallStore((s) => s.localStream)
  const accept = useCallStore((s) => s.accept)
  const decline = useCallStore((s) => s.decline)
  const end = useCallStore((s) => s.end)
  const toggleMute = useCallStore((s) => s.toggleMute)
  const toggleCamera = useCallStore((s) => s.toggleCamera)
  const self = useIdentityStore((s) => s.identity)

  // Mic + speaker come from the global audio prefs (same selection used in
  // UserPanel); camera stays call-local because it is only relevant in-call.
  const micDeviceId = useAudioPrefsStore((s) => s.inputDeviceId)
  const speakerDeviceId = useAudioPrefsStore((s) => s.outputDeviceId)
  const setMicDevice = useAudioPrefsStore((s) => s.setInputDevice)
  const setSpeakerDevice = useAudioPrefsStore((s) => s.setOutputDevice)
  const cameraDeviceId = useCallStore((s) => s.cameraDeviceId)
  const setCameraDevice = useCallStore((s) => s.setCameraDevice)

  const [showSettings, setShowSettings] = useState(false)
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

  useEffect(() => registerAudioSink(audioRef.current), [remoteStream])

  if (status === 'idle' || !peerId) return null

  const duration = startedAt ? now - startedAt : 0
  const hasRemoteVideo = !!remoteStream && remoteStream.getVideoTracks().some((t) => t.enabled && !t.muted)
  const hasLocalVideo = !!localStream && localStream.getVideoTracks().some((t) => t.enabled && !t.muted)
  const showVideoSurface = status === 'active' && kind === 'video'
  const showRemoteVideo = showVideoSurface && hasRemoteVideo
  const callTypeLabel = kind === 'video' ? 'Direct Video' : 'Direct Voice'
  const qualityLabel = callQualityLabel(peerRtt)

  if (status === 'incoming' || status === 'outgoing' || status === 'declined') {
    const title =
      status === 'incoming'
        ? `Incoming ${kind} call`
        : status === 'outgoing'
          ? `Calling ${peerName}...`
          : 'Call declined'
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
            <div className="relative mt-7 flex items-center justify-center gap-4">
              <button
                onClick={decline}
                className="mesh-pressable mesh-icon-button mesh-icon-phone grid h-12 w-12 place-items-center rounded-full bg-mesh-danger text-white shadow-[0_14px_32px_rgba(229,72,77,0.28)] transition hover:opacity-90"
                title="Decline"
              >
                <PhoneOff className="h-5 w-5" />
              </button>
              <button
                onClick={accept}
                className="mesh-pressable mesh-icon-button mesh-icon-phone grid h-12 w-12 place-items-center rounded-full bg-mesh-green text-white shadow-[0_14px_32px_rgba(35,165,89,0.28)] transition hover:bg-mesh-green-light"
                title="Accept"
              >
                <Phone className="h-5 w-5" />
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
            <p className="relative mt-5 text-center text-xs text-mesh-text-muted">The call was declined.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-mesh-bg-primary text-mesh-text-primary">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-mesh-border/60 bg-mesh-bg-secondary/80 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-mesh-green/25 bg-mesh-green/12 text-mesh-green">
            {kind === 'video' ? <Video className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
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

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-lg border border-mesh-border/60 bg-mesh-bg-tertiary/70 px-2.5 py-1.5 text-[11px] font-semibold text-mesh-text-muted sm:inline-flex">
            <Signal className="h-3.5 w-3.5 text-mesh-green" />
            {qualityLabel}
          </span>
          <button
            onClick={() => end(true)}
            className="mesh-pressable mesh-icon-button mesh-icon-phone grid h-8 w-8 place-items-center rounded-md text-mesh-text-secondary transition-colors hover:bg-mesh-danger/15 hover:text-mesh-danger"
            title="Leave call"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(45,212,191,0.10),transparent_34%),radial-gradient(circle_at_80%_12%,rgba(96,165,250,0.08),transparent_30%)]" />

        <section className="relative flex min-w-0 flex-1 flex-col gap-4 p-4">
          <div className="mesh-reveal-in mesh-shimmer relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-mesh-border/70 bg-mesh-bg-secondary/72 shadow-[0_24px_70px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)]">
            {showRemoteVideo ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full bg-black object-contain"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-16">
                  <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-black/55 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur">
                    <UserRound className="h-4 w-4" />
                    <span className="truncate">{peerName || peerId}</span>
                  </span>
                </div>
              </>
            ) : (
              <div className="relative flex h-full w-full flex-col items-center justify-center p-6 text-center">
                <div className="absolute inset-x-1/4 top-1/2 h-48 -translate-y-1/2 rounded-full bg-mesh-green/12 blur-3xl" />
                <div className={cn(
                  'relative isolate rounded-full bg-mesh-bg-tertiary p-1.5 transition-all',
                  isRemoteSpeaking && 'mesh-speaking-ring'
                )}>
                  {isRemoteSpeaking && <VoiceDetectionRing size="lg" />}
                  <UserAvatar userId={peerId} fallback={peerName || peerId} size="xl" status="online" />
                </div>
                <h2 className="relative mt-5 max-w-full truncate text-2xl font-bold text-mesh-text-primary">
                  {peerName || peerId}
                </h2>
                <div className="relative mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-mesh-text-muted">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-mesh-border/60 bg-mesh-bg-primary/70 px-3 py-1">
                    {kind === 'video' ? <VideoOff className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    {kind === 'video' ? 'Camera off' : 'Voice connected'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-mesh-border/60 bg-mesh-bg-primary/70 px-3 py-1">
                    <Sparkles className="h-3.5 w-3.5 text-mesh-green" />
                    {qualityLabel}
                  </span>
                </div>
              </div>
            )}

            {isCameraOn && hasLocalVideo && (
              <div className="mesh-hover-lift absolute bottom-4 right-4 aspect-video w-44 overflow-hidden rounded-xl border border-mesh-border/70 bg-black shadow-[0_18px_46px_rgba(0,0,0,0.35)]">
                <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
                <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                  You
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="relative hidden w-72 shrink-0 border-l border-mesh-border/60 bg-mesh-bg-secondary/55 p-4 xl:block">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wide text-mesh-text-muted">In call</h3>
            <span className="rounded-full border border-mesh-border/60 bg-mesh-bg-tertiary px-2 py-0.5 text-[10px] font-bold text-mesh-text-muted">
              2
            </span>
          </div>
          <ParticipantRow
            userId={peerId}
            fallback={peerName || peerId}
            label={peerName || peerId}
            detail={qualityLabel}
            speaking={isRemoteSpeaking}
          />
          <ParticipantRow
            userId={self?.userId}
            fallback={self?.username || 'You'}
            label={self?.username || 'You'}
            detail={isMuted ? 'Muted' : 'Mic on'}
            muted={isMuted}
            speaking={isLocalSpeaking}
          />
        </aside>
      </main>

      <footer className="relative flex h-[86px] shrink-0 items-center justify-center gap-3 border-t border-mesh-border/60 bg-mesh-bg-secondary/90 px-4 backdrop-blur">
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
          title="End call"
          iconMotion="phone"
          danger
          wide
          onClick={() => end(true)}
        >
          <PhoneOff className="h-5 w-5" />
          <span>Leave</span>
        </CallControlButton>
      </footer>

      <audio ref={audioRef} autoPlay />
    </div>
  )
}

function ParticipantRow({
  userId,
  fallback,
  label,
  detail,
  muted,
  speaking
}: {
  userId?: string | null
  fallback: string
  label: string
  detail: string
  muted?: boolean
  speaking?: boolean
}): JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-xl border border-mesh-border/60 bg-mesh-bg-primary/60 p-3">
      <div className={cn('relative isolate rounded-full bg-mesh-bg-tertiary p-0.5', speaking && 'mesh-speaking-ring')}>
        {speaking && <VoiceDetectionRing size="sm" bars={false} />}
        <UserAvatar userId={userId} fallback={fallback} size="md" status={muted ? 'idle' : 'online'} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-mesh-text-primary">{label}</div>
        <div className="mt-0.5 truncate text-[11px] text-mesh-text-muted">{detail}</div>
      </div>
      {muted && <MicOff className="h-4 w-4 shrink-0 text-mesh-warning" />}
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
