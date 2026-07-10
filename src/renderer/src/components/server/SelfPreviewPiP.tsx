import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Minimize2, Maximize2, Square, Eye } from 'lucide-react'
import { useVoiceStore } from '@/stores/voice.store'
import { cn } from '@/lib/utils'

/**
 * Floating self-preview PiP. Mounted globally; shown whenever
 * `localMediaStream` is set AND `previewVisible` is true.
 *
 * UX rules:
 *  • X button HIDES the preview only. Stream keeps running.
 *  • Square (stop) button STOPS the stream.
 *  • Collapse/expand toggle only adjusts visual height — the <video>
 *    element stays mounted so srcObject never gets detached (black-screen fix).
 *  • When the stream is live but the PiP is hidden, a tiny "Show preview"
 *    pill appears in the bottom-right so users can bring it back.
 */
function SelfPreviewPiP(): JSX.Element | null {
  const localMediaStream = useVoiceStore((s) => s.localMediaStream)
  const previewVisible = useVoiceStore((s) => s.previewVisible)
  const currentStreamSource = useVoiceStore((s) => s.currentStreamSource)
  const hidePreview = useVoiceStore((s) => s.hidePreview)
  const showPreview = useVoiceStore((s) => s.showPreview)
  const stopStream = useVoiceStore((s) => s.stopStream)

  const videoRef = useRef<HTMLVideoElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth - 340 : 20,
    y: typeof window !== 'undefined' ? window.innerHeight - 240 : 20
  }))

  // Attach srcObject whenever the stream changes. The <video> is always
  // mounted, so the ref never becomes null between renders — no black screen.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (localMediaStream) {
      if (el.srcObject !== localMediaStream) el.srcObject = localMediaStream
      el.play().catch(() => { /* autoplay is fine, user has already gestured */ })
    } else {
      el.srcObject = null
    }
  }, [localMediaStream])

  // When the tile becomes visible again (un-hide or un-collapse) some browsers
  // pause the underlying video if tracks haven't been read for a while. Explicit
  // play() on visibility changes keeps playback flowing.
  useEffect(() => {
    const el = videoRef.current
    if (el && localMediaStream && previewVisible && !collapsed) {
      el.play().catch(() => { /* ignore */ })
    }
  }, [previewVisible, collapsed, localMediaStream])

  // Simple drag handling on the header.
  // Guard: if the pointerdown originated on (or inside) a button, we let the
  // button handle the click instead of hijacking the pointer for a drag. This
  // is why the close/collapse/stop buttons previously appeared dead — the
  // header was capturing every pointerdown before the click could fire.
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const onHeaderPointerDown = (e: React.PointerEvent): void => {
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y }
  }
  const onHeaderPointerMove = (e: React.PointerEvent): void => {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    const nx = Math.max(4, Math.min(window.innerWidth - 100, dragState.current.originX + dx))
    const ny = Math.max(4, Math.min(window.innerHeight - 60, dragState.current.originY + dy))
    setPos({ x: nx, y: ny })
  }
  const onHeaderPointerUp = (): void => {
    dragState.current = null
  }

  if (typeof document === 'undefined') return null
  if (!localMediaStream) return null

  const kindLabel =
    currentStreamSource?.kind === 'camera'
      ? 'Camera'
      : currentStreamSource?.kind === 'screen'
        ? 'Screen'
        : currentStreamSource?.kind === 'window'
          ? 'Window'
          : 'Stream'

  const isCamera = currentStreamSource?.kind === 'camera'

  // When hidden: show a compact pill so the user can bring the preview back.
  if (!previewVisible) {
    return createPortal(
      <button
        type="button"
        onClick={showPreview}
        className="fixed z-[150] bottom-4 right-4 flex items-center gap-2 rounded-full bg-black/85 hover:bg-black border border-mesh-border px-3 py-2 text-xs font-semibold text-white shadow-xl"
        title="Show self preview"
      >
        <span className="inline-flex items-center gap-1 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
          Live
        </span>
        <Eye className="h-3.5 w-3.5" />
        Show preview
      </button>,
      document.body
    )
  }

  return createPortal(
    <div
      className={cn(
        'fixed z-[150] select-none rounded-xl overflow-hidden shadow-2xl border border-mesh-border bg-black flex flex-col',
        'w-[320px]'
      )}
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header — drag handle + controls */}
      <div
        className="flex items-center justify-between gap-2 px-2 py-1.5 bg-mesh-bg-primary/95 cursor-move"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <div className="flex items-center gap-1.5 min-w-0 pointer-events-none">
          <span className="inline-flex items-center gap-1 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            Live
          </span>
          <span className="text-xs text-mesh-text-secondary truncate">{kindLabel} preview</span>
        </div>
        <div
          className="flex items-center gap-0.5 shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <IconButton
            tooltip={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton tooltip="Hide preview (keep streaming)" onClick={hidePreview}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton tooltip="Stop streaming" onClick={stopStream} danger>
            <Square className="h-3 w-3 fill-current" />
          </IconButton>
        </div>
      </div>

      {/* Video — always mounted; collapsed only collapses the visual height. */}
      <div
        className={cn(
          'relative bg-black transition-[height] duration-150',
          collapsed ? 'h-0' : 'aspect-video'
        )}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={cn(
            'w-full h-full bg-black',
            isCamera ? '-scale-x-100 object-cover' : 'object-contain'
          )}
        />
      </div>

      {/* Source hint — so users know what remote peers are seeing */}
      {!collapsed && (
        <div className="px-2 py-1.5 bg-mesh-bg-primary/95 border-t border-mesh-border/40 text-[10px] text-mesh-text-muted truncate">
          Peers see: {describeSource(currentStreamSource?.kind, currentStreamSource?.label, currentStreamSource?.includeAudio)}
        </div>
      )}
    </div>,
    document.body
  )
}

function describeSource(kind?: string, label?: string, includeAudio?: boolean): string {
  if (kind === 'camera') return `your camera${label ? ` (${label})` : ''}`
  const sound = includeAudio ? ' with sound' : ''
  if (kind === 'window') return `the window "${label ?? 'selected'}"${sound}`
  if (kind === 'screen') return `your entire screen${label ? ` (${label})` : ''}${sound}`
  return 'your stream'
}

function IconButton({
  onClick,
  tooltip,
  danger,
  children
}: {
  onClick: () => void
  tooltip: string
  danger?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={cn(
        'h-6 w-6 rounded flex items-center justify-center',
        danger
          ? 'text-red-400 hover:text-red-300 hover:bg-red-500/15'
          : 'text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary'
      )}
    >
      {children}
    </button>
  )
}

export { SelfPreviewPiP }
