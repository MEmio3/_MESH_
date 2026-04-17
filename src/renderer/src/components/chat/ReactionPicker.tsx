import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface ReactionPickerProps {
  onSelect: (emojiId: string) => void
  onClose: () => void
  /**
   * Optional anchor element. When provided, the picker is portaled to
   * document.body and positioned next to the anchor with viewport-aware
   * flip so it never clips against the top/bottom edge of the window.
   */
  anchorRef?: RefObject<HTMLElement | null>
}

// emoji-mart picker at default width/rows is roughly this size.
const PICKER_W = 352
const PICKER_H = 435

export function ReactionPicker({ onSelect, onClose, anchorRef }: ReactionPickerProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Compute fixed-viewport position relative to the anchor (if any).
  useLayoutEffect(() => {
    if (!anchorRef?.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8

    // Prefer opening below the trigger; flip above if not enough room.
    const spaceBelow = vh - rect.bottom
    const spaceAbove = rect.top
    let top: number
    if (spaceBelow >= PICKER_H + margin) {
      top = rect.bottom + margin
    } else if (spaceAbove >= PICKER_H + margin) {
      top = rect.top - PICKER_H - margin
    } else {
      // Not enough either way — pin to whichever side has more room, clamped.
      top = spaceBelow >= spaceAbove
        ? Math.max(margin, vh - PICKER_H - margin)
        : margin
    }

    // Horizontally prefer right-aligned to the trigger, clamp into viewport.
    let left = rect.right - PICKER_W
    if (left < margin) left = margin
    if (left + PICKER_W > vw - margin) left = vw - PICKER_W - margin

    setPos({ top, left })
  }, [anchorRef])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Fallback for call sites that don't pass an anchorRef — preserve legacy
  // absolute positioning relative to the caller's `.relative` wrapper.
  if (!anchorRef) {
    return (
      <div
        ref={ref}
        className="absolute bottom-full right-0 mb-2 z-50 shadow-2xl rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
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
      </div>
    )
  }

  // Portaled, viewport-aware placement.
  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 shadow-2xl rounded-lg"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}
    >
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
    </div>,
    document.body
  )
}
