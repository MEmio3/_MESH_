import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, PhoneIncoming, PhoneOutgoing } from 'lucide-react'
import { useCallStore } from '@/stores/call.store'
import { UserAvatar } from '@/components/ui/UserAvatar'

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
      <div className="h-20 border-t border-mesh-border/50 flex items-center justify-center gap-3 shrink-0">
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
