import { useEffect, useRef } from 'react'
import { useVoiceStore } from '@/stores/voice.store'
import { useIdentityStore } from '@/stores/identity.store'
import { registerAudioSink } from '@/stores/audioPrefs.store'

/**
 * App-level playback engine for voice-room audio.
 *
 * Mounted once in AppShell — NOT inside the voice-room page — for two reasons:
 *   1. Audio must keep playing while the user browses text channels, DMs or
 *      settings. The old in-page players unmounted (and killed all audio) the
 *      moment the user navigated away from the voice room.
 *   2. It is the SINGLE audio authority for voice rooms. Stream tiles and the
 *      full-screen viewer render video only (muted) so the same remote stream
 *      is never played twice.
 *
 * Also honors deafen: previously deafen only muted the microphone; incoming
 * audio kept playing.
 */
function VoiceAudioEngine(): JSX.Element | null {
  const remoteStreams = useVoiceStore((s) => s.remoteStreams)
  const isConnected = useVoiceStore((s) => s.isConnected)
  const isDeafened = useVoiceStore((s) => s.isDeafened)
  const selfId = useIdentityStore((s) => s.identity?.userId)

  if (!isConnected) return null

  const entries = Array.from(remoteStreams.entries()).filter(([id]) => id !== selfId)
  return (
    <div className="hidden">
      {entries.map(([userId, stream]) => (
        <EnginePlayer key={userId} userId={userId} stream={stream} muted={isDeafened} />
      ))}
    </div>
  )
}

function EnginePlayer({ userId, stream, muted }: { userId: string; stream: MediaStream; muted: boolean }): JSX.Element {
  const ref = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    el.play().catch(() => { /* retried when the stream identity changes */ })
  }, [stream])

  // Honor the global speaker device + output volume.
  useEffect(() => registerAudioSink(ref.current, userId), [stream, userId])

  useEffect(() => {
    if (ref.current) ref.current.muted = muted
  }, [muted])

  return <audio ref={ref} autoPlay />
}

export { VoiceAudioEngine }
