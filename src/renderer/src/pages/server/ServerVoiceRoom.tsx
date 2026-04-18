import { useEffect, useRef } from 'react'
import { Volume2, Users, AlertTriangle, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVoiceStore } from '@/stores/voice.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { registerAudioSink } from '@/stores/audioPrefs.store'
import { VoiceControlBar } from '@/components/server/VoiceControlBar'
import { Avatar } from '@/components/ui/Avatar'
import type { Server } from '@/types/server'
import type { VoiceParticipant } from '@/types/server'

/**
 * TODO (mediasoup SFU): The current implementation uses a full WebRTC mesh for
 * voice rooms, which scales cleanly up to ~8 participants. Beyond that, per-peer
 * upload bandwidth and encoder CPU become prohibitive (O(n) streams per client).
 *
 * Upgrade path when participants.length > MESH_PARTICIPANT_SOFT_CAP:
 *   - Integrate a mediasoup SFU so each client uploads a single stream and
 *     receives one forwarded copy per other participant.
 *   - Add router/transport negotiation via signaling, migrate peers from mesh.
 *   - See Phase 2 networking plan.
 */
const MESH_PARTICIPANT_SOFT_CAP = 8

interface ServerVoiceRoomProps {
  server: Server
}

function ServerVoiceRoom({ server }: ServerVoiceRoomProps): JSX.Element {
  const {
    isConnected,
    participants,
    remoteStreams,
    streamingUsers,
    localMediaStream,
    currentStreamSource,
    joinRoom
  } = useVoiceStore()
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const overCap = participants.length > MESH_PARTICIPANT_SOFT_CAP
  const selfSourceKind = currentStreamSource?.kind ?? null

  if (!isConnected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 h-12 px-4 border-b border-mesh-border/50 shrink-0">
          <Volume2 className="h-4.5 w-4.5 text-mesh-green" />
          <span className="text-sm font-semibold text-mesh-text-primary">
            {server.voiceRoomName}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center justify-center text-center">
            <Volume2 className="h-16 w-16 text-mesh-text-muted mb-4" />
            <h3 className="text-xl font-bold text-mesh-text-primary mb-2">
              {server.voiceRoomName}
            </h3>
            <p className="text-sm text-mesh-text-muted mb-8">Click to join voice</p>
            <button
              onClick={() => joinRoom(server.id)}
              className="bg-mesh-green hover:bg-mesh-green/90 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              Join Voice
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Split participants into streamers (screen/camera) and non-streamers
  const streamers = participants.filter((p) => streamingUsers.has(p.userId))
  const nonStreamers = participants.filter((p) => !streamingUsers.has(p.userId))

  const hasStreamers = streamers.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-mesh-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <Volume2 className="h-4.5 w-4.5 text-mesh-green" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-mesh-text-primary">
              {server.voiceRoomName}
            </span>
            <span className="bg-mesh-bg-tertiary text-mesh-text-muted text-[10px] font-bold px-1.5 py-0.5 rounded-sm">
              <Users className="inline h-3 w-3 mr-1 -mt-0.5" />
              {participants.length}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {overCap && (
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs px-3 py-1.5 rounded">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Mesh over capacity</span>
            </div>
          )}
        </div>
      </div>

      {/* Discord-style layout: stream tiles on top, avatar row below */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {hasStreamers ? (
          <StreamGrid
            streamers={streamers}
            remoteStreams={remoteStreams}
            localMediaStream={localMediaStream}
            selfSourceKind={selfSourceKind}
            selfId={selfId}
          />
        ) : (
          /* No streamers — show the regular avatar-circles tile grid */
          <ParticipantGrid participants={participants} selfId={selfId} />
        )}

        {hasStreamers && nonStreamers.length > 0 && (
          <AvatarRow participants={nonStreamers} selfId={selfId} />
        )}
      </div>

      <VoiceControlBar />
    </div>
  )
}

/* ─────────────────────────────── Stream grid ─────────────────────────────── */

interface StreamGridProps {
  streamers: VoiceParticipant[]
  remoteStreams: Map<string, MediaStream>
  localMediaStream: MediaStream | null
  selfSourceKind: 'screen' | 'window' | 'camera' | null
  selfId: string | undefined
}

function StreamGrid({
  streamers,
  remoteStreams,
  localMediaStream,
  selfSourceKind,
  selfId
}: StreamGridProps): JSX.Element {
  const n = streamers.length
  // Responsive layout — 1, 2, or N up to 4 per row
  const gridCols =
    n === 1
      ? 'grid-cols-1'
      : n === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : n <= 4
          ? 'grid-cols-2'
          : 'grid-cols-2 lg:grid-cols-3'

  return (
    <div className={cn('grid gap-3 flex-1', gridCols)}>
      {streamers.map((p) => {
        const isSelf = p.userId === selfId
        return (
          <StreamTile
            key={p.userId}
            participant={p}
            stream={isSelf ? localMediaStream : remoteStreams.get(p.userId) || null}
            isSelf={isSelf}
            isCameraStream={isSelf && selfSourceKind === 'camera'}
          />
        )
      })}
    </div>
  )
}

interface StreamTileProps {
  participant: VoiceParticipant
  stream: MediaStream | null
  isSelf: boolean
  isCameraStream?: boolean
}

function StreamTile({ participant, stream, isSelf, isCameraStream }: StreamTileProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const openStreamViewer = useVoiceStore((s) => s.openStreamViewer)

  // Always re-attach srcObject whenever the stream identity changes.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (stream) {
      if (el.srcObject !== stream) el.srcObject = stream
      el.play().catch(() => {
        /* autoplay can be rejected — user gesture already occurred by opening room */
      })
    } else {
      el.srcObject = null
    }
  }, [stream])

  // Honor the global speaker device + output volume on remote tiles.
  useEffect(() => {
    if (isSelf) return
    return registerAudioSink(videoRef.current)
  }, [isSelf, stream])

  return (
    <button
      type="button"
      onClick={() => openStreamViewer(participant.userId)}
      title="Click to view full stream"
      className="relative rounded-xl overflow-hidden bg-black border border-mesh-border/40 aspect-video cursor-pointer group text-left focus:outline-none focus:ring-2 focus:ring-mesh-green"
    >
      {/* Always mount the <video> so the ref is stable; show a placeholder overlay
          when we don't yet have a MediaStream (self: stream starting; remote: awaiting tracks). */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={cn(
          'w-full h-full bg-black',
          isCameraStream ? '-scale-x-100 object-cover' : 'object-contain'
        )}
      />
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center bg-mesh-bg-tertiary">
          <span className="text-sm text-mesh-text-muted">
            {isSelf ? 'Starting stream…' : 'Connecting stream…'}
          </span>
        </div>
      )}

      {/* LIVE badge — clickable (whole tile is a button; visual affordance only) */}
      <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-red-500 px-2 py-0.5 text-[10px] font-bold uppercase leading-none text-white shadow-md group-hover:bg-red-600 transition-colors">
        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
        Live
      </div>

      {/* Hover hint — Discord-style "click to view" */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors pointer-events-none">
        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-semibold text-white bg-black/70 px-3 py-1.5 rounded-full">
          View stream
        </span>
      </div>

      {/* Muted overlay */}
      {participant.isMuted && (
        <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 flex items-center justify-center">
          <MicOff className="h-3.5 w-3.5 text-red-400" />
        </div>
      )}

      {/* Username pill at bottom */}
      <div className="absolute bottom-2 left-2 right-2 flex justify-start">
        <span className="bg-black/70 px-2.5 py-1 rounded text-xs font-semibold text-white truncate max-w-full">
          {participant.username}
          {isSelf && <span className="ml-1 text-mesh-text-muted font-normal">(you)</span>}
        </span>
      </div>
    </button>
  )
}

/* ──────────────────────────── Avatar row (idle) ──────────────────────────── */

interface AvatarRowProps {
  participants: VoiceParticipant[]
  selfId: string | undefined
}

function AvatarRow({ participants, selfId }: AvatarRowProps): JSX.Element {
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 shrink-0 pt-2 pb-1">
      {participants.map((p) => {
        const src = p.userId === selfId ? selfAvatar : avatarsByUser[p.userId]
        return (
          <div
            key={p.userId}
            className={cn(
              'flex flex-col items-center gap-1.5 px-2 transition-all',
              p.isSpeaking && 'scale-105'
            )}
          >
            <div
              className={cn(
                'relative rounded-full',
                p.isSpeaking && 'ring-2 ring-mesh-green shadow-lg shadow-mesh-green/20'
              )}
            >
              <Avatar fallback={p.username} size="lg" src={src} />
              {p.isMuted && (
                <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-mesh-bg-elevated flex items-center justify-center border border-mesh-bg-primary">
                  <MicOff className="h-3 w-3 text-red-400" />
                </div>
              )}
            </div>
            <span className="text-xs text-mesh-text-secondary max-w-[80px] truncate">
              {p.username}
              {p.userId === selfId && (
                <span className="text-mesh-text-muted"> (you)</span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ──────────────────── Full-screen non-streamer grid (no streamers) ─────────────────── */

interface ParticipantGridProps {
  participants: VoiceParticipant[]
  selfId: string | undefined
}

function ParticipantGrid({ participants, selfId }: ParticipantGridProps): JSX.Element {
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)

  return (
    <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 auto-rows-min content-start">
      {participants.map((p) => {
        const src = p.userId === selfId ? selfAvatar : avatarsByUser[p.userId]
        return (
          <div
            key={p.userId}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-xl bg-mesh-bg-tertiary p-6 min-h-[160px] transition-colors',
              p.isSpeaking && 'ring-2 ring-mesh-green shadow-lg shadow-mesh-green/10'
            )}
          >
            <div className="relative">
              <Avatar fallback={p.username} size="xl" src={src} />
              {p.isMuted && (
                <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-mesh-bg-elevated flex items-center justify-center border border-mesh-bg-tertiary">
                  <MicOff className="h-3 w-3 text-red-400" />
                </div>
              )}
            </div>
            <span className="mt-3 text-sm text-mesh-text-primary truncate max-w-[90%]">
              {p.username}
              {p.userId === selfId && (
                <span className="text-mesh-text-muted text-xs ml-1">(you)</span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export { ServerVoiceRoom }
