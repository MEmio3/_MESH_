import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2 } from 'lucide-react'
import { useVoiceStore } from '@/stores/voice.store'
import { useIdentityStore } from '@/stores/identity.store'
import { cn } from '@/lib/utils'

/**
 * Full-screen viewer for a remote (or self) participant's live stream.
 * Opened by clicking a "Live" badge/tile — gives Discord-style expansion
 * so the user can verify the stream is actually flowing.
 */
function StreamViewerModal(): JSX.Element | null {
  const viewingUserId = useVoiceStore((s) => s.viewingStreamUserId)
  const closeViewer = useVoiceStore((s) => s.closeStreamViewer)
  const remoteStreams = useVoiceStore((s) => s.remoteStreams)
  const localMediaStream = useVoiceStore((s) => s.localMediaStream)
  const currentStreamSource = useVoiceStore((s) => s.currentStreamSource)
  const participants = useVoiceStore((s) => s.participants)
  const selfId = useIdentityStore((s) => s.identity?.userId)

  const videoRef = useRef<HTMLVideoElement>(null)

  const isSelf = viewingUserId === selfId
  const stream = isSelf ? localMediaStream : viewingUserId ? remoteStreams.get(viewingUserId) ?? null : null
  const participant = participants.find((p) => p.userId === viewingUserId)
  const isCamera = isSelf && currentStreamSource?.kind === 'camera'

  // Close on Esc
  useEffect(() => {
    if (!viewingUserId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeViewer()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [viewingUserId, closeViewer])

  // Attach srcObject
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (stream) {
      if (el.srcObject !== stream) el.srcObject = stream
      el.play().catch(() => { /* ignore */ })
    } else {
      el.srcObject = null
    }
  }, [stream])

  if (!viewingUserId) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {viewingUserId && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-black/90"
            onClick={closeViewer}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="relative w-[90vw] h-[85vh] rounded-xl overflow-hidden bg-black border border-mesh-border shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-black/80 border-b border-mesh-border/40">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-sm border border-mesh-danger/40 bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider leading-none text-mesh-danger">
                  <span className="h-1 w-1 rounded-full bg-mesh-danger animate-pulse" />
                  Live
                </span>
                <span className="text-sm font-semibold text-white truncate">
                  {participant?.username ?? 'Unknown'}
                  {isSelf && <span className="ml-1 text-white/60 font-normal">(you)</span>}
                </span>
                <Maximize2 className="h-3.5 w-3.5 text-white/50" />
              </div>
              <button
                onClick={closeViewer}
                className="h-8 w-8 rounded-md flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Video */}
            <div className="relative flex-1 bg-black">
              {/* Muted: audio playback is owned by VoiceAudioEngine — an unmuted
                  element here would double every remote voice while viewing. */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn(
                  'w-full h-full bg-black',
                  isCamera ? '-scale-x-100 object-contain' : 'object-contain'
                )}
              />
              {!stream && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm text-white/60">
                    {isSelf ? 'Starting stream…' : 'Waiting for remote stream…'}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export { StreamViewerModal }
