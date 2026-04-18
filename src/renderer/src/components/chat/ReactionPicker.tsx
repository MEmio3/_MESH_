import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface ReactionPickerProps {
  onSelect: (emojiId: string) => void
  onClose: () => void
  /**
   * Optional anchor element. When provided, the picker is portaled to
   * document.body and positioned next to the anchor with viewport-aware
   * flip so it never clips against the top/bottom edge of the window or the
   * chat header.
   */
  anchorRef?: RefObject<HTMLElement | null>
}

// Full emoji-mart picker footprint.
const FULL_W = 352
const FULL_H = 435

// Compact quick-strip footprint (7 emoji + plus button).
const STRIP_W = 296
const STRIP_H = 44

// Minimum top offset so the picker never slides up under the chat header /
// title bar (roughly: window chrome + ChatHeader = ~80px).
const SAFE_TOP = 80

/**
 * Curated set of frequently-used reactions. `id` matches emoji-mart's
 * canonical id so the picker + the reaction store speak the same language.
 */
const QUICK_EMOJIS: { id: string; char: string }[] = [
  { id: '+1',              char: '👍' },
  { id: 'heart',           char: '❤️' },
  { id: 'joy',             char: '😂' },
  { id: 'open_mouth',      char: '😮' },
  { id: 'cry',             char: '😢' },
  { id: 'fire',            char: '🔥' },
  { id: 'tada',            char: '🎉' }
]

export function ReactionPicker({ onSelect, onClose, anchorRef }: ReactionPickerProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Compute fixed-viewport position relative to the anchor (if any).
  const popW = expanded ? FULL_W : STRIP_W
  const popH = expanded ? FULL_H : STRIP_H

  useLayoutEffect(() => {
    if (!anchorRef?.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8

    // Prefer opening below; flip above if cramped.
    const spaceBelow = vh - rect.bottom
    const spaceAbove = rect.top - SAFE_TOP
    let top: number
    if (spaceBelow >= popH + margin) {
      top = rect.bottom + margin
    } else if (spaceAbove >= popH + margin) {
      top = rect.top - popH - margin
    } else {
      // Not enough either way — pin to whichever side has more room, clamped
      // so the picker never creeps above the chat header / app chrome.
      top = spaceBelow >= spaceAbove
        ? Math.max(SAFE_TOP, vh - popH - margin)
        : SAFE_TOP
    }

    // Horizontally prefer right-aligned to the trigger, clamp into viewport.
    let left = rect.right - popW
    if (left < margin) left = margin
    if (left + popW > vw - margin) left = vw - popW - margin

    setPos({ top, left })
  }, [anchorRef, expanded, popH, popW])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  /** Quick-pick strip: 7 curated emojis + expand-to-full button. */
  const stripBody = (
    <div
      className="flex items-center gap-0.5 rounded-full bg-[#111214] border border-black/50 shadow-2xl px-1.5 py-1"
      style={{ width: STRIP_W, height: STRIP_H }}
    >
      {QUICK_EMOJIS.map((e) => (
        <button
          key={e.id}
          onClick={() => { onSelect(e.id); onClose() }}
          className="h-9 w-9 rounded-full flex items-center justify-center text-xl hover:bg-white/[0.08] transition-colors"
          title={e.id.replace(/_/g, ' ')}
        >
          <span className="leading-none">{e.char}</span>
        </button>
      ))}
      <div className="w-px h-6 bg-white/[0.08] mx-0.5" />
      <button
        onClick={() => setExpanded(true)}
        className="h-9 w-9 rounded-full flex items-center justify-center text-[#b5bac1] hover:text-[#dbdee1] hover:bg-white/[0.08] transition-colors"
        title="More emoji"
        aria-label="Open full emoji picker"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )

  /** Full emoji-mart picker. */
  const fullBody = (
    <Picker
      data={data}
      theme="dark"
      onEmojiSelect={(e: { id: string }) => {
        onSelect(e.id)
        onClose()
      }}
      previewPosition="none"
      skinTonePosition="none"
    />
  )

  // Fallback for call sites that don't pass an anchorRef — preserve legacy
  // absolute positioning relative to the caller's `.relative` wrapper.
  if (!anchorRef) {
    return (
      <div
        ref={ref}
        className="absolute bottom-full right-0 mb-2 z-50"
        onClick={(e) => e.stopPropagation()}
      >
        {expanded ? fullBody : stripBody}
      </div>
    )
  }

  // Portaled, viewport-aware placement.
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[60]"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {expanded ? fullBody : stripBody}
    </div>,
    document.body
  )
}
