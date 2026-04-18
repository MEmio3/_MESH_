/**
 * Discord-style popover for picking a microphone / speaker and adjusting its
 * volume. Used in two places:
 *   - Chevron next to the Mute button → input (microphone) popover.
 *   - Chevron next to the Deafen/Headphones button → output (speaker) popover.
 *
 * Rendered via a portal so it escapes the user-panel stacking context and can
 * float above any other UI.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Mic, Volume2, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAudioPrefsStore } from '@/stores/audioPrefs.store'

type Kind = 'input' | 'output'

interface Props {
  kind: Kind
  anchorRef: React.RefObject<HTMLElement>
  open: boolean
  onClose: () => void
}

const POPOVER_W = 300

function AudioDevicePopover({ kind, anchorRef, open, onClose }: Props): JSX.Element | null {
  const navigate = useNavigate()
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const inputDeviceId = useAudioPrefsStore((s) => s.inputDeviceId)
  const outputDeviceId = useAudioPrefsStore((s) => s.outputDeviceId)
  const inputVolume = useAudioPrefsStore((s) => s.inputVolume)
  const outputVolume = useAudioPrefsStore((s) => s.outputVolume)
  const setInputDevice = useAudioPrefsStore((s) => s.setInputDevice)
  const setOutputDevice = useAudioPrefsStore((s) => s.setOutputDevice)
  const setInputVolume = useAudioPrefsStore((s) => s.setInputVolume)
  const setOutputVolume = useAudioPrefsStore((s) => s.setOutputVolume)

  const isInput = kind === 'input'
  const currentId = isInput ? inputDeviceId : outputDeviceId
  const currentVol = isInput ? inputVolume : outputVolume
  const setDevice = isInput ? setInputDevice : setOutputDevice
  const setVolume = isInput ? setInputVolume : setOutputVolume
  const targetKind = isInput ? 'audioinput' : 'audiooutput'
  const heading = isInput ? 'Input Device' : 'Output Device'
  const volHeading = isInput ? 'Input Volume' : 'Output Volume'
  const IconCmp = isInput ? Mic : Volume2

  // Load devices whenever the popover opens, and when the OS reports changes.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        // Request mic permission up front so labels become available.
        if (isInput) {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true })
            s.getTracks().forEach((t) => t.stop())
          } catch { /* user may deny; labels stay generic */ }
        }
        const list = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) setDevices(list.filter((d) => d.kind === targetKind))
      } catch { /* ignore */ }
    }
    refresh()
    navigator.mediaDevices.addEventListener?.('devicechange', refresh)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh)
    }
  }, [open, targetKind, isInput])

  // Position the popover directly above the anchor button, Discord-style.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const a = anchorRef.current
    if (!a) return
    const rect = a.getBoundingClientRect()
    const popH = popRef.current?.getBoundingClientRect().height ?? 280
    const top = Math.max(8, rect.top - popH - 8)
    let left = rect.left + rect.width / 2 - POPOVER_W / 2
    left = Math.max(8, Math.min(window.innerWidth - POPOVER_W - 8, left))
    setPos({ top, left })
  }, [open, anchorRef, devices.length])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (popRef.current?.contains(e.target as Node)) return
      if (anchorRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  const selected = devices.find((d) => d.deviceId === currentId) || null
  const selectedLabel = selected?.label
    || (currentId ? `Device ${currentId.slice(0, 6)}` : 'System default')

  const panel = (
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: POPOVER_W,
        zIndex: 70
      }}
      className="rounded-lg bg-[#111214] border border-black/50 shadow-2xl p-3 flex flex-col gap-3 text-[#dbdee1]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Device section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <IconCmp className="h-4 w-4 text-[#b5bac1]" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#b5bac1]">
            {heading}
          </span>
        </div>
        <div className="text-[13px] text-[#dbdee1] truncate pl-6">{selectedLabel}</div>
        <div className="max-h-56 overflow-y-auto rounded-md border border-white/[0.06] bg-[#1e1f22]">
          <button
            onClick={() => setDevice(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors ${
              currentId === null
                ? 'bg-[#404249] text-white'
                : 'hover:bg-white/[0.04] text-[#dbdee1]'
            }`}
          >
            <span className="flex-1 truncate">System default</span>
            {currentId === null && <ChevronRight className="h-3.5 w-3.5 opacity-70" />}
          </button>
          {devices.map((d) => {
            const active = d.deviceId === currentId
            return (
              <button
                key={d.deviceId}
                onClick={() => setDevice(d.deviceId)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors ${
                  active
                    ? 'bg-[#404249] text-white'
                    : 'hover:bg-white/[0.04] text-[#dbdee1]'
                }`}
              >
                <span className="flex-1 truncate">{d.label || `Device ${d.deviceId.slice(0, 6)}`}</span>
                {active && <ChevronRight className="h-3.5 w-3.5 opacity-70" />}
              </button>
            )
          })}
          {devices.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-[#949ba4]">
              No {isInput ? 'microphones' : 'speakers'} detected.
            </div>
          )}
        </div>
      </div>

      {/* Volume slider */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#b5bac1]">
          {volHeading}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={isInput ? 200 : 100}
            value={currentVol}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="flex-1 accent-[#5865f2] h-1"
          />
          <span className="text-[11px] font-mono text-[#b5bac1] w-8 text-right">
            {currentVol}%
          </span>
        </div>
      </div>

      {/* Footer — link to full settings */}
      <button
        onClick={() => {
          onClose()
          navigate('/settings')
        }}
        className="flex items-center justify-between border-t border-white/[0.06] pt-2 mt-1 text-[13px] text-[#dbdee1] hover:text-white transition-colors"
      >
        <span className="font-medium">Voice Settings</span>
        <Settings className="h-4 w-4 text-[#b5bac1]" />
      </button>
    </div>
  )

  return createPortal(panel, document.body)
}

export { AudioDevicePopover }
