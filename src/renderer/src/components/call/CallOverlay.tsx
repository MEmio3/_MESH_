import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, PhoneIncoming, PhoneOutgoing, Settings, Volume2 } from 'lucide-react'
import { useCallStore } from '@/stores/call.store'
import { useAudioPrefsStore } from '@/stores/audioPrefs.store'
import { registerAudioSink } from '@/stores/audioPrefs.store'
import { UserAvatar } from '@/components/ui/UserAvatar'

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
      } catch { /* ignore */ }
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

function CallOverlay(): JSX.Element | null {
  const status = useCallStore((s) => s.status)
  const peerId = useCallStore((s) => s.peerId)
  const peerName = useCallStore((s) => s.peerName)
  const kind = useCallStore((s) => s.kind)
  const isMuted = useCallStore((s) => s.isMuted)
  const isCameraOn = useCallStore((s) => s.isCameraOn)
  const startedAt = useCallStore((s) => s.startedAt)
  const remoteStream = useCallStore((s) => s.remoteStream)
  const localStream = useCallStore((s) => s.localStream)
  const accept = useCallStore((s) => s.accept)
  const decline = useCallStore((s) => s.decline)
  const end = useCallStore((s) => s.end)
  const toggleMute = useCallStore((s) => s.toggleMute)
  const toggleCamera = useCallStore((s) => s.toggleCamera)
  // Mic + speaker come from the global audio prefs (same selection used in
  // UserPanel); camera stays call-local because it's only relevant in-call.
  const micDeviceId = useAudioPrefsStore((s) => s.inputDeviceId)
  const speakerDeviceId = useAudioPrefsStore((s) => s.outputDeviceId)
  const setMicDevice = useAudioPrefsStore((s) => s.setInputDevice)
  const setSpeakerDevice = useAudioPrefsStore((s) => s.setOutputDevice)
  const cameraDeviceId = useCallStore((s) => s.cameraDeviceId)
  const setCameraDevice = useCallStore((s) => s.setCameraDevice)

  const [showSettings, setShowSettings] = useState(false)
  const devices = useMediaDevices(showSettings)

  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)

  // Tick every second while active, so duration updates live.
  const now = useTicker(status === 'active')

  // Attach streams to media elements.
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

  // Register our remote <audio> element with the global sink registry so the
  // app-wide speaker device + output volume are applied automatically.
  useEffect(() => registerAudioSink(audioRef.current), [remoteStream])

  if (status === 'idle' || !peerId) return null

  const showRing = status === 'incoming' || status === 'outgoing'
  const duration = startedAt ? now - startedAt : 0
  const hasRemoteVideo = !!remoteStream && remoteStream.getVideoTracks().some((t) => t.enabled && !t.muted)
  const showVideoSurface = status === 'active' && kind === 'video'

  // Ring / outgoing / declined → compact centered modal.
  if (showRing || status === 'declined') {
    const title =
      status === 'incoming'
        ? `Incoming ${kind} call`
        : status === 'outgoing'
          ? `Calling ${peerName}…`
          : 'Call declined'
    const Icon = status === 'incoming' ? PhoneIncoming : PhoneOutgoing

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[320px] rounded-2xl bg-mesh-bg-secondary border border-mesh-border shadow-2xl p-6 flex flex-col items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-mesh-text-muted">
            <Icon className="h-3.5 w-3.5" />
            {title}
          </div>
          <UserAvatar userId={peerId} fallback={peerName || peerId} size="lg" />
          <div className="text-lg font-semibold text-mesh-text-primary">{peerName || peerId}</div>

          {status === 'incoming' && (
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={decline}
                className="h-12 w-12 rounded-full bg-mesh-danger text-white flex items-center justify-center hover:opacity-90 transition"
                title="Decline"
              >
                <PhoneOff className="h-5 w-5" />
              </button>
              <button
                onClick={accept}
                className="h-12 w-12 rounded-full bg-mesh-green text-white flex items-center justify-center hover:opacity-90 transition"
                title="Accept"
              >
                <Phone className="h-5 w-5" />
              </button>
            </div>
          )}

          {status === 'outgoing' && (
            <button
              onClick={() => end(true)}
              className="h-11 px-5 rounded-full bg-mesh-danger text-white flex items-center gap-2 hover:opacity-90 transition text-sm font-medium mt-2"
            >
              <PhoneOff className="h-4 w-4" />
              Cancel
            </button>
          )}

          {status === 'declined' && (
            <p className="text-xs text-mesh-text-muted">The call was declined.</p>
          )}
        </div>
      </div>
    )
  }

  // Active call → full-screen panel with avatar or video tiles, controls.
  return (
    <div className="fixed inset-0 z-50 bg-mesh-bg-primary flex flex-col">
      {/* Header */}
      <div className="h-14 px-6 border-b border-mesh-border/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <UserAvatar userId={peerId} fallback={peerName || peerId} size="sm" />
          <div>
            <div className="text-sm font-semibold text-mesh-text-primary">{peerName || peerId}</div>
            <div className="text-[11px] text-mesh-text-muted font-mono">
              {formatDuration(duration)} · {kind === 'video' ? 'Video call' : 'Voice call'}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-mesh-bg-secondary">
        {showVideoSurface && hasRemoteVideo ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="max-h-full max-w-full object-contain bg-black"
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <UserAvatar userId={peerId} fallback={peerName || peerId} size="lg" />
            <div className="text-xl font-semibold text-mesh-text-primary">{peerName || peerId}</div>
            <div className="text-sm text-mesh-text-muted">
              {hasRemoteVideo ? '' : kind === 'video' ? 'Camera off' : 'Voice call in progress'}
            </div>
          </div>
        )}

        {/* Local preview PiP (only when video on) */}
        {isCameraOn && localStream && (
          <div className="absolute bottom-4 right-4 w-40 aspect-video rounded-lg overflow-hidden bg-black border border-mesh-border shadow-xl">
            <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="relative h-20 border-t border-mesh-border/50 flex items-center justify-center gap-3 shrink-0">
        {showSettings && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-[380px] rounded-xl bg-mesh-bg-secondary border border-mesh-border shadow-2xl p-4 flex flex-col gap-3 z-10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-mesh-text-muted">Audio & Video devices</span>
              <button
                onClick={() => setShowSettings(false)}
                className="text-xs text-mesh-text-muted hover:text-mesh-text-primary"
              >
                Close
              </button>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-mesh-text-secondary flex items-center gap-1.5"><Mic className="h-3 w-3" /> Microphone</span>
              <select
                value={micDeviceId || ''}
                onChange={(e) => setMicDevice(e.target.value || null)}
                className="bg-mesh-bg-tertiary text-mesh-text-primary text-sm rounded px-2 py-1.5 border border-mesh-border outline-none focus:border-mesh-green"
              >
                <option value="">System default</option>
                {devices.mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 6)}`}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-mesh-text-secondary flex items-center gap-1.5"><Volume2 className="h-3 w-3" /> Speaker</span>
              <select
                value={speakerDeviceId || ''}
                onChange={(e) => setSpeakerDevice(e.target.value || null)}
                className="bg-mesh-bg-tertiary text-mesh-text-primary text-sm rounded px-2 py-1.5 border border-mesh-border outline-none focus:border-mesh-green"
              >
                <option value="">System default</option>
                {devices.speakers.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 6)}`}</option>
                ))}
              </select>
              {devices.speakers.length === 0 && (
                <span className="text-[10px] text-mesh-text-muted">Speaker selection may be unavailable in this environment.</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-mesh-text-secondary flex items-center gap-1.5"><Video className="h-3 w-3" /> Camera</span>
              <select
                value={cameraDeviceId || ''}
                onChange={(e) => setCameraDevice(e.target.value || null)}
                className="bg-mesh-bg-tertiary text-mesh-text-primary text-sm rounded px-2 py-1.5 border border-mesh-border outline-none focus:border-mesh-green"
              >
                <option value="">System default</option>
                {devices.cams.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 6)}`}</option>
                ))}
              </select>
            </label>
            <p className="text-[10px] text-mesh-text-muted leading-snug">
              If the other side can&apos;t hear you, try a different microphone here. Device labels are only shown once
              you&apos;ve granted mic/camera permission.
            </p>
          </div>
        )}
        <button
          onClick={() => setShowSettings((v) => !v)}
          className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
            showSettings
              ? 'bg-mesh-green text-white'
              : 'bg-mesh-bg-tertiary text-mesh-text-primary hover:bg-mesh-bg-hover'
          }`}
          title="Audio & video devices"
        >
          <Settings className="h-5 w-5" />
        </button>
        <button
          onClick={toggleMute}
          className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
            isMuted
              ? 'bg-mesh-danger text-white hover:opacity-90'
              : 'bg-mesh-bg-tertiary text-mesh-text-primary hover:bg-mesh-bg-hover'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          onClick={() => toggleCamera()}
          className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
            isCameraOn
              ? 'bg-mesh-bg-tertiary text-mesh-text-primary hover:bg-mesh-bg-hover'
              : 'bg-mesh-bg-tertiary text-mesh-text-muted hover:bg-mesh-bg-hover'
          }`}
          title={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {isCameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>
        <button
          onClick={() => end(true)}
          className="h-12 px-6 rounded-full bg-mesh-danger text-white flex items-center gap-2 hover:opacity-90 transition text-sm font-semibold"
          title="End call"
        >
          <PhoneOff className="h-5 w-5" />
          End
        </button>
      </div>

      {/* Audio sink for voice-only or when remote has no video */}
      <audio ref={audioRef} autoPlay />
    </div>
  )
}

export { CallOverlay }
