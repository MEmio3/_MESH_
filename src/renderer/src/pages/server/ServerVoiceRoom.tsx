import { useEffect, useRef } from 'react'
import { AlertTriangle, MicOff, Radio, ScreenShare, Sparkles, Users, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVoiceStore } from '@/stores/voice.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { VoiceControlBar } from '@/components/server/VoiceControlBar'
import { Avatar } from '@/components/ui/Avatar'
import { VoiceDetectionRing } from '@/components/voice/VoiceDetectionRing'
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
      <div className="flex h-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-mesh-border/50 px-4">
          <div className="grid h-7 w-7 place-items-center rounded-lg border border-mesh-border/60 bg-mesh-bg-tertiary text-mesh-green">
            <Volume2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold text-mesh-text-primary">
              {server.voiceRoomName}
            </span>
            <span className="block text-[10px] uppercase tracking-wide text-mesh-text-muted">Voice room</span>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="mesh-reveal-in mesh-shimmer relative w-full max-w-lg overflow-hidden rounded-3xl border border-mesh-border/70 bg-mesh-bg-secondary/85 p-8 text-center shadow-[0_24px_70px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="absolute inset-x-10 -top-24 h-44 rounded-full bg-mesh-green/16 blur-3xl" />
            <div className="relative mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl border border-mesh-green/25 bg-mesh-green/12 text-mesh-green shadow-[0_18px_42px_rgba(35,165,89,0.18)]">
              <Volume2 className="h-10 w-10" />
            </div>
            <h3 className="relative mb-2 text-2xl font-bold text-mesh-text-primary">
              {server.voiceRoomName}
            </h3>
            <p className="relative mx-auto mb-6 max-w-sm text-sm text-mesh-text-muted">
              Join the room to talk, listen, or start a stream.
            </p>
            <div className="relative mb-6 grid grid-cols-3 gap-2 text-left">
              <VoiceStat icon={<Radio className="h-3.5 w-3.5" />} label="Mode" value="Mesh" />
              <VoiceStat icon={<Users className="h-3.5 w-3.5" />} label="People" value={`${participants.length}`} />
              <VoiceStat icon={<ScreenShare className="h-3.5 w-3.5" />} label="Streams" value={`${streamingUsers.size}`} />
            </div>
            <button
              onClick={() => joinRoom(server.id)}
              className="mesh-pressable relative inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-green px-6 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(35,165,89,0.28)] transition hover:bg-mesh-green-light"
            >
              <Volume2 className="h-4 w-4" />
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
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-mesh-border/50 bg-mesh-bg-secondary/55 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-7 w-7 place-items-center rounded-lg border border-mesh-green/25 bg-mesh-green/12 text-mesh-green">
            <Volume2 className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-mesh-text-primary">
              {server.voiceRoomName}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-mesh-border/60 bg-mesh-bg-tertiary px-2 py-0.5 text-[10px] font-bold text-mesh-text-muted">
              <Users className="h-3 w-3" />
              {participants.length}
            </span>
            {hasStreamers && (
              <span className="mesh-live-badge inline-flex items-center gap-1 rounded-full border border-red-400/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                Live
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {overCap && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Mesh over capacity</span>
            </div>
          )}
        </div>
      </div>

      {/* Discord-style layout: stream tiles on top, avatar row below */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(35,165,89,0.05),transparent_34%)] p-4">
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
      {/* Audio playback lives in the app-level VoiceAudioEngine (AppShell) so
          it survives navigating away from this page. */}
    </div>
  )
}

/* ─────────────────────────────── Stream grid ─────────────────────────────── */

function VoiceStat({
  icon,
  label,
  value
}: {
  icon: JSX.Element
  label: string
  value: string
}): JSX.Element {
  return (
    <div className="rounded-xl border border-mesh-border/60 bg-mesh-bg-tertiary/55 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="mb-1 flex items-center gap-1.5 text-mesh-text-muted">
        {icon}
        <span className="text-[9px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <span className="block truncate text-sm font-semibold text-mesh-text-primary">{value}</span>
    </div>
  )
}

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
    <div className={cn('grid flex-1 gap-3', gridCols)}>
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

  return (
    <button
      type="button"
      onClick={() => openStreamViewer(participant.userId)}
      title="Click to view full stream"
      className="mesh-hover-lift group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border border-mesh-border/60 bg-black text-left shadow-[0_18px_46px_rgba(0,0,0,0.32)] outline-none transition hover:border-mesh-green/40 focus:ring-2 focus:ring-mesh-green"
    >
      {/* Always mount the <video> so the ref is stable; show a placeholder overlay
          when we don't yet have a MediaStream (self: stream starting; remote: awaiting tracks).
          Muted for remote too — VoiceAudioEngine is the single audio authority,
          otherwise the same remote stream would play twice. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          'w-full h-full bg-black',
          isCameraStream ? '-scale-x-100 object-cover' : 'object-contain'
        )}
      />
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center bg-mesh-bg-tertiary">
          <span className="rounded-full border border-mesh-border/60 bg-mesh-bg-secondary/85 px-3 py-1.5 text-sm text-mesh-text-muted">
            {isSelf ? 'Starting stream…' : 'Connecting stream…'}
          </span>
        </div>
      )}

      {/* LIVE badge — quiet technical indicator, not an alarm */}
      <div className="mesh-live-badge absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-red-400/35 bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider leading-none text-red-300 backdrop-blur-sm">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
        Live
      </div>

      {/* Hover hint — Discord-style "click to view" */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
        <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
          View stream
        </span>
      </div>

      {/* Muted overlay */}
      {participant.isMuted && (
        <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-red-400/25 bg-black/65">
          <MicOff className="h-3.5 w-3.5 text-red-400" />
        </div>
      )}

      {/* Username pill at bottom */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
        <span className="inline-flex max-w-full items-center rounded-lg border border-white/10 bg-black/55 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
          {participant.username}
          {isSelf && <span className="ml-1 font-normal text-white/60">(you)</span>}
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
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 rounded-2xl border border-mesh-border/60 bg-mesh-bg-secondary/55 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {participants.map((p) => {
        const src = p.userId === selfId ? selfAvatar : avatarsByUser[p.userId]
        return (
          <div
            key={p.userId}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl px-3 py-2 transition-all',
              p.isSpeaking && 'scale-105'
            )}
          >
            <div
              className={cn(
                'relative isolate rounded-full bg-mesh-bg-tertiary p-1',
                p.isSpeaking && 'mesh-speaking-ring ring-2 ring-mesh-green shadow-lg shadow-mesh-green/25'
              )}
            >
              {p.isSpeaking && <VoiceDetectionRing size="sm" />}
              <Avatar fallback={p.username} size="lg" src={src} />
              {p.isMuted && (
                <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-mesh-bg-elevated flex items-center justify-center border border-mesh-bg-primary">
                  <MicOff className="h-3 w-3 text-red-400" />
                </div>
              )}
            </div>
            <span className="max-w-[88px] truncate text-xs font-medium text-mesh-text-secondary">
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
    <div className="grid flex-1 auto-rows-min grid-cols-2 content-start gap-3 md:grid-cols-3 lg:grid-cols-4">
      {participants.map((p) => {
        const src = p.userId === selfId ? selfAvatar : avatarsByUser[p.userId]
        return (
          <div
            key={p.userId}
            className={cn(
              'mesh-hover-lift relative flex min-h-[168px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-mesh-border/60 bg-mesh-bg-secondary/70 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition',
              p.isSpeaking && 'border-mesh-green/45 ring-2 ring-mesh-green/70 shadow-[0_18px_44px_rgba(35,165,89,0.12)]'
            )}
          >
            {p.isSpeaking && <div className="absolute inset-x-8 -top-14 h-24 rounded-full bg-mesh-green/18 blur-2xl" />}
            <div className={cn('relative isolate rounded-full bg-mesh-bg-tertiary p-1', p.isSpeaking && 'mesh-speaking-ring')}>
              {p.isSpeaking && <VoiceDetectionRing size="lg" />}
              <Avatar fallback={p.username} size="xl" src={src} />
              {p.isMuted && (
                <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-mesh-bg-elevated flex items-center justify-center border border-mesh-bg-tertiary">
                  <MicOff className="h-3 w-3 text-red-400" />
                </div>
              )}
            </div>
            <span className="mt-3 max-w-[90%] truncate text-sm font-semibold text-mesh-text-primary">
              {p.username}
              {p.userId === selfId && (
                <span className="text-mesh-text-muted text-xs ml-1">(you)</span>
              )}
            </span>
            {p.isSpeaking && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-mesh-green/25 bg-mesh-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-mesh-green">
                <Sparkles className="h-3 w-3" />
                Speaking
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export { ServerVoiceRoom }
