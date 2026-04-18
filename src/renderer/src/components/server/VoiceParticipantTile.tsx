import { useRef, useEffect } from 'react'
import { MicOff, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { registerAudioSink } from '@/stores/audioPrefs.store'
import type { VoiceParticipant } from '@/types/server'

interface VoiceParticipantTileProps {
  participant: VoiceParticipant
  stream?: MediaStream | null
}

function VoiceParticipantTile({ participant, stream }: VoiceParticipantTileProps): JSX.Element {
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)
  const avatarSrc = participant.userId === selfId ? selfAvatar : avatarsByUser[participant.userId]
  const videoRef = useRef<HTMLVideoElement>(null)

  // Attach the MediaStream to the <video> element when it changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }
  }, [stream])

  // Register the <video> as a playback sink so the global speaker/output
  // volume applies (unless this tile is the local user's own preview).
  useEffect(() => {
    if (participant.userId === selfId) return
    return registerAudioSink(videoRef.current)
  }, [participant.userId, selfId, stream])

  const hasVideo = stream && stream.getVideoTracks().length > 0

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center rounded-xl bg-mesh-bg-tertiary p-4 min-h-[140px] transition-colors overflow-hidden',
        participant.isSpeaking && 'ring-2 ring-mesh-green animate-pulse shadow-lg shadow-mesh-green/10'
      )}
    >
      {/* Video stream (shown when receiving video/screen share) */}
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.userId === selfId}
          className="absolute inset-0 w-full h-full object-cover rounded-xl"
        />
      ) : (
        <>
          {/* Hidden video element for audio-only streams */}
          {stream && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={participant.userId === selfId}
              className="hidden"
            />
          )}
        </>
      )}

      {/* Avatar block — shown when no video */}
      {!hasVideo && (
        <div className="relative">
          <Avatar fallback={participant.username} size="xl" src={avatarSrc} />
          
          {/* Muted indicator */}
          {participant.isMuted && (
            <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-mesh-bg-elevated flex items-center justify-center border border-mesh-bg-tertiary z-10">
              <MicOff className="h-3 w-3 text-red-400" />
            </div>
          )}

          {/* Screen sharing indicator */}
          {participant.isScreenSharing && (
            <div className="absolute -bottom-1 -left-1 h-5 w-5 rounded-full bg-mesh-bg-elevated flex items-center justify-center border border-mesh-bg-tertiary z-10">
              <Monitor className="h-3 w-3 text-mesh-text-primary" />
            </div>
          )}
        </div>
      )}

      {/* Username — overlaid on video, or below avatar */}
      <span className={cn(
        'text-sm text-center truncate w-full max-w-[90%]',
        hasVideo
          ? 'absolute bottom-2 left-0 right-0 text-white font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] px-2'
          : 'text-mesh-text-primary mt-3'
      )}>
        {participant.username}
      </span>

      {/* Muted badge overlaid on video */}
      {hasVideo && participant.isMuted && (
        <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 flex items-center justify-center">
          <MicOff className="h-3.5 w-3.5 text-red-400" />
        </div>
      )}
    </div>
  )
}

export { VoiceParticipantTile }
