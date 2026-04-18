import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

interface NamePromptModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  label?: string
  placeholder?: string
  initialValue?: string
  submitLabel?: string
  maxLength?: number
  onSubmit: (value: string) => void | Promise<void>
}

/**
 * Minimal "enter a name" dialog used for Create Category / Create Channel /
 * Rename. Pre-fills + selects initialValue, submits on Enter, disables when
 * the trimmed value is empty or unchanged.
 */
export function NamePromptModal({
  isOpen,
  onClose,
  title,
  label,
  placeholder,
  initialValue = '',
  submitLabel = 'Create',
  maxLength = 64,
  onSubmit
}: NamePromptModalProps): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isOpen) setValue(initialValue)
  }, [isOpen, initialValue])

  const trimmed = value.trim()
  const disabled = busy || trimmed.length === 0 || trimmed === initialValue.trim()

  async function handleSubmit(): Promise<void> {
    if (disabled) return
    setBusy(true)
    try {
      await onSubmit(trimmed)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        {label && <label className="text-xs font-semibold uppercase tracking-wide text-mesh-text-muted">{label}</label>}
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          placeholder={placeholder}
          maxLength={maxLength}
          className="w-full rounded-md bg-mesh-bg-primary border border-mesh-border px-3 py-2 text-sm text-mesh-text-primary outline-none focus:border-mesh-green"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={disabled}>{submitLabel}</Button>
        </div>
      </div>
    </Modal>
  )
}
