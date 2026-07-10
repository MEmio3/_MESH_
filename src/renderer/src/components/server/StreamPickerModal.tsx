import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Monitor, AppWindow, Camera, Check, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVoiceStore, type StreamSource, type StreamQuality } from '@/stores/voice.store'

interface StreamPickerModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'applications' | 'screens' | 'camera'
  title?: string
  onShare?: (source: StreamSource, quality: StreamQuality) => Promise<void>
}

type Tab = 'applications' | 'screens' | 'camera'

interface DesktopSource {
  id: string
  name: string
  display_id: string
  thumbnail: string | null
  appIcon: string | null
}

interface CameraDevice {
  deviceId: string
  label: string
}

function StreamPickerModal({ isOpen, onClose, initialTab = 'applications', title = 'Share your screen', onShare }: StreamPickerModalProps): JSX.Element | null {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [windows, setWindows] = useState<DesktopSource[]>([])
  const [screens, setScreens] = useState<DesktopSource[]>([])
  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [selected, setSelected] = useState<StreamSource | null>(null)
  const [quality, setQuality] = useState<StreamQuality>('SD')
  const [includeAudio, setIncludeAudio] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startVoiceStreamFromSource = useVoiceStore((s) => s.startStreamFromSource)

  // Close on Esc
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Load sources when modal opens
  useEffect(() => {
    if (!isOpen) return
    setTab(initialTab)
    setSelected(null)
    setIncludeAudio(false)
    setError(null)

    window.api
      .desktopGetSources({ types: ['window'], thumbnailWidth: 320, thumbnailHeight: 180 })
      .then(setWindows)
      .catch((e) => setError(String(e)))

    window.api
      .desktopGetSources({ types: ['screen'], thumbnailWidth: 320, thumbnailHeight: 180 })
      .then(setScreens)
      .catch((e) => setError(String(e)))

    // Cameras — enumerateDevices requires permission; triggering a short
    // getUserMedia first unlocks labels. We keep it lightweight: ask for
    // video, release immediately. If denied, labels show as "Camera N".
    ;(async () => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true })
        probe.getTracks().forEach((t) => t.stop())
      } catch {
        /* permission denied — continue with empty labels */
      }
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cams = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
      setCameras(cams)
    })().catch((e) => setError(String(e)))
  }, [isOpen])

  const qualityLabel = useMemo(
    () => (quality === 'HD' ? '1080p · 60fps' : '720p · 30fps'),
    [quality]
  )

  const canShare = selected !== null && !sharing

  const handleShare = async (): Promise<void> => {
    if (!selected) return
    setSharing(true)
    setError(null)
    try {
      const source = selected.kind === 'camera'
        ? selected
        : { ...selected, includeAudio }
      await (onShare ?? startVoiceStreamFromSource)(source, quality)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSharing(false)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/70"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative w-full max-w-4xl mx-4 rounded-xl bg-mesh-bg-secondary border border-mesh-border shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-mesh-border/60">
              <h2 className="text-lg font-bold text-mesh-text-primary">{title}</h2>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-3 pt-3 border-b border-mesh-border/40">
              <TabButton
                active={tab === 'applications'}
                onClick={() => {
                  setTab('applications')
                  setSelected(null)
                }}
                icon={<AppWindow className="h-4 w-4" />}
                label="Applications"
              />
              <TabButton
                active={tab === 'screens'}
                onClick={() => {
                  setTab('screens')
                  setSelected(null)
                }}
                icon={<Monitor className="h-4 w-4" />}
                label="Entire Screen"
              />
              <TabButton
                active={tab === 'camera'}
                onClick={() => {
                  setTab('camera')
                  setSelected(null)
                  setIncludeAudio(false)
                }}
                icon={<Camera className="h-4 w-4" />}
                label="Camera"
              />
            </div>

            {/* Source grid */}
            <div className="h-[360px] overflow-y-auto p-4">
              {tab === 'applications' && (
                <SourceGrid
                  sources={windows}
                  selectedId={selected?.sourceId}
                  onSelect={(s) =>
                    setSelected({ kind: 'window', sourceId: s.id, label: s.name })
                  }
                  emptyLabel="No open application windows found."
                />
              )}
              {tab === 'screens' && (
                <SourceGrid
                  sources={screens}
                  selectedId={selected?.sourceId}
                  onSelect={(s) =>
                    setSelected({ kind: 'screen', sourceId: s.id, label: s.name })
                  }
                  emptyLabel="No screens detected."
                />
              )}
              {tab === 'camera' && (
                <CameraGrid
                  cameras={cameras}
                  selectedId={selected?.deviceId}
                  onSelect={(c) =>
                    setSelected({ kind: 'camera', deviceId: c.deviceId, label: c.label })
                  }
                />
              )}
            </div>

            {/* Quality + Share */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-mesh-border/60 bg-mesh-bg-primary/40">
              <div className="flex items-center gap-3">
                <div className="flex items-center bg-mesh-bg-tertiary rounded-lg p-1">
                  <QualityPill
                    label="SD"
                    active={quality === 'SD'}
                    onClick={() => setQuality('SD')}
                  />
                  <QualityPill
                    label="HD"
                    active={quality === 'HD'}
                    onClick={() => setQuality('HD')}
                  />
                </div>
                <span className="text-xs text-mesh-text-muted">{qualityLabel}</span>
                {selected && selected.kind !== 'camera' && (
                  <button
                    type="button"
                    onClick={() => setIncludeAudio((value) => !value)}
                    className={cn(
                      'mesh-pressable inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors',
                      includeAudio
                        ? 'border-mesh-green/55 bg-mesh-green/15 text-mesh-green'
                        : 'border-mesh-border/70 bg-mesh-bg-tertiary text-mesh-text-muted hover:text-mesh-text-primary'
                    )}
                  >
                    {includeAudio ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    {includeAudio ? 'Sound on' : 'No sound'}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {error && (
                  <span className="text-xs text-red-400 max-w-[220px] truncate">{error}</span>
                )}
                <button
                  onClick={handleShare}
                  disabled={!canShare}
                  className={cn(
                    'px-5 py-2 rounded-lg font-medium transition-colors',
                    canShare
                      ? 'bg-mesh-green hover:bg-mesh-green/90 text-white'
                      : 'bg-mesh-bg-tertiary text-mesh-text-muted cursor-not-allowed'
                  )}
                >
                  {sharing ? 'Starting…' : 'Share'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: JSX.Element
  label: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm rounded-t-md transition-colors',
        active
          ? 'text-mesh-text-primary border-b-2 border-mesh-green -mb-px'
          : 'text-mesh-text-muted hover:text-mesh-text-secondary'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function QualityPill({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
        active
          ? 'bg-mesh-green text-white'
          : 'text-mesh-text-muted hover:text-mesh-text-primary'
      )}
    >
      {label}
    </button>
  )
}

function SourceGrid({
  sources,
  selectedId,
  onSelect,
  emptyLabel
}: {
  sources: DesktopSource[]
  selectedId?: string
  onSelect: (s: DesktopSource) => void
  emptyLabel: string
}): JSX.Element {
  if (sources.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-mesh-text-muted">{emptyLabel}</span>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {sources.map((s) => {
        const selected = selectedId === s.id
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s)}
            className={cn(
              'group relative flex flex-col overflow-hidden rounded-lg border-2 transition-colors text-left bg-mesh-bg-tertiary',
              selected
                ? 'border-mesh-green'
                : 'border-transparent hover:border-mesh-border'
            )}
          >
            {s.thumbnail ? (
              <img
                src={s.thumbnail}
                alt={s.name}
                className="w-full aspect-video object-cover bg-black"
              />
            ) : (
              <div className="w-full aspect-video bg-black/60 flex items-center justify-center">
                <Monitor className="h-8 w-8 text-mesh-text-muted" />
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-2">
              {s.appIcon && (
                <img src={s.appIcon} alt="" className="h-4 w-4 shrink-0" />
              )}
              <span className="text-xs text-mesh-text-primary truncate">{s.name}</span>
            </div>
            {selected && (
              <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-mesh-green flex items-center justify-center">
                <Check className="h-3.5 w-3.5 text-white" />
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function CameraGrid({
  cameras,
  selectedId,
  onSelect
}: {
  cameras: CameraDevice[]
  selectedId?: string
  onSelect: (c: CameraDevice) => void
}): JSX.Element {
  if (cameras.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-mesh-text-muted">No cameras detected.</span>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cameras.map((c) => {
        const selected = selectedId === c.deviceId
        return (
          <button
            key={c.deviceId}
            onClick={() => onSelect(c)}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-lg border-2 px-4 py-6 bg-mesh-bg-tertiary transition-colors',
              selected
                ? 'border-mesh-green'
                : 'border-transparent hover:border-mesh-border'
            )}
          >
            <Camera className="h-8 w-8 text-mesh-text-muted mb-3" />
            <span className="text-xs text-mesh-text-primary text-center truncate max-w-full">
              {c.label}
            </span>
            {selected && (
              <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-mesh-green flex items-center justify-center">
                <Check className="h-3.5 w-3.5 text-white" />
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

export { StreamPickerModal }
