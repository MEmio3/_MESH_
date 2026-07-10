import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { SendHorizontal, Paperclip, X, FileIcon, Undo2, Redo2, Scissors, Copy, ClipboardPaste, TextCursorInput, Reply, type LucideIcon } from 'lucide-react'
import type { MessageReply } from '@/types/messages'

interface PendingFile {
  path: string
  name: string
  size: number
  type: string
  preview?: string // data URL for images
}

type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'

interface EditMenuItem {
  command: EditCommand
  label: string
  shortcut: string
  Icon: LucideIcon
  requiresSelection?: boolean
  requiresValue?: boolean
}

const EDIT_MENU_GROUPS: EditMenuItem[][] = [
  [
    { command: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', Icon: Undo2 },
    { command: 'redo', label: 'Redo', shortcut: 'Ctrl+Y', Icon: Redo2 }
  ],
  [
    { command: 'cut', label: 'Cut', shortcut: 'Ctrl+X', Icon: Scissors, requiresSelection: true },
    { command: 'copy', label: 'Copy', shortcut: 'Ctrl+C', Icon: Copy, requiresSelection: true },
    { command: 'paste', label: 'Paste', shortcut: 'Ctrl+V', Icon: ClipboardPaste }
  ],
  [
    { command: 'selectAll', label: 'Select All', shortcut: 'Ctrl+A', Icon: TextCursorInput, requiresValue: true }
  ]
]

interface MessageInputProps {
  recipientName: string
  onSend: (content: string, replyTo?: MessageReply) => void
  onSendFile?: (filePath: string) => void
  onTypingStart?: () => void
  onTypingStop?: () => void
  replyTo?: MessageReply
  onCancelReply?: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read clipboard file.'))
    reader.readAsDataURL(file)
  })
}

function MessageInput({ recipientName, onSend, onSendFile, onTypingStart, onTypingStop, replyTo, onCancelReply }: MessageInputProps): JSX.Element {
  const [value, setValue] = useState('')
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null)
  const [pasteError, setPasteError] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean; hasValue: boolean } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const lastTypingEmit = useRef<number>(0)

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
    }
  }, [])

  const emitTypingStart = useCallback(() => {
    if (!onTypingStart) return
    const now = Date.now()
    if (now - lastTypingEmit.current > 2000) {
      lastTypingEmit.current = now
      onTypingStart()
    }
  }, [onTypingStart])

  const emitTypingStop = useCallback(() => {
    if (!onTypingStop) return
    lastTypingEmit.current = 0
    onTypingStop()
  }, [onTypingStop])

  useEffect(() => {
    const handleInsertMention = (event: Event): void => {
      const detail = (event as CustomEvent<{ text?: string }>).detail
      const mention = detail?.text?.trim()
      if (!mention) return
      setValue((current) => {
        const spacer = current.length > 0 && !/\s$/.test(current) ? ' ' : ''
        return `${current}${spacer}${mention} `
      })
      requestAnimationFrame(() => {
        adjustHeight()
        textareaRef.current?.focus()
      })
      emitTypingStart()
    }

    window.addEventListener('mesh:insert-mention', handleInsertMention)
    return () => window.removeEventListener('mesh:insert-mention', handleInsertMention)
  }, [adjustHeight, emitTypingStart])

  useEffect(() => {
    if (!replyTo) return
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [replyTo])

  useEffect(() => {
    if (!contextMenu) return
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    const closeOnResize = (): void => setContextMenu(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnResize)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [contextMenu])

  const handleSend = (): void => {
    if (pendingFile && onSendFile) {
      onSendFile(pendingFile.path)
      setPendingFile(null)
      // Also send text if present
      const trimmed = value.trim()
      if (trimmed) {
        onSend(trimmed, replyTo)
        setValue('')
      }
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      emitTypingStop()
      return
    }

    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed, replyTo)
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    emitTypingStop()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePickFile = async (): Promise<void> => {
    const filePath = await window.api.file.pick()
    if (!filePath) return

    const fileData = await window.api.file.read(filePath)
    if (!fileData) return

    const maxSize = await window.api.file.maxSize()
    if (fileData.fileSize > maxSize) {
      // TODO: show error toast
      console.warn('File too large (max 50MB)')
      return
    }

    const pending: PendingFile = {
      path: filePath,
      name: fileData.fileName,
      size: fileData.fileSize,
      type: fileData.fileType
    }

    // Image preview
    if (fileData.fileType.startsWith('image/')) {
      pending.preview = `data:${fileData.fileType};base64,${fileData.base64}`
    }

    setPendingFile(pending)
    setPasteError('')
  }

  const prepareClipboardFile = useCallback(async (file: File): Promise<void> => {
    if (!onSendFile) {
      setPasteError('You do not have permission to attach files here.')
      return
    }

    const maxSize = await window.api.file.maxSize()
    if (file.size > maxSize) {
      setPasteError(`That file is too large. Maximum size is ${formatFileSize(maxSize)}.`)
      return
    }

    try {
      const dataUrl = await fileToDataUrl(file)
      const comma = dataUrl.indexOf(',')
      if (comma < 0) throw new Error('Clipboard data was not readable.')
      const fileType = file.type || 'application/octet-stream'
      const pastedExtension: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp'
      }
      const fileName = file.name || `pasted-${Date.now()}${pastedExtension[fileType] || ''}`
      const saved = await window.api.file.saveClipboard({
        fileName,
        fileType,
        base64: dataUrl.slice(comma + 1)
      })
      if (!saved.success || !saved.filePath) throw new Error(saved.error || 'Could not stage clipboard file.')

      setPendingFile({
        path: saved.filePath,
        name: fileName,
        size: file.size,
        type: fileType,
        preview: fileType.startsWith('image/') ? dataUrl : undefined
      })
      setPasteError('')
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : 'Could not paste that file.')
    }
  }, [onSendFile])

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) {
      for (const item of Array.from(event.clipboardData.items)) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length === 0) return
    event.preventDefault()
    void prepareClipboardFile(files[0])
  }

  const openContextMenu = (event: React.MouseEvent<HTMLTextAreaElement>): void => {
    event.preventDefault()
    const target = event.currentTarget
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 214)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 260)),
      hasSelection: target.selectionStart !== target.selectionEnd,
      hasValue: target.value.length > 0
    })
  }

  const runEditCommand = (command: EditCommand): void => {
    setContextMenu(null)
    textareaRef.current?.focus({ preventScroll: true })
    window.api.editCommand(command)
  }

  const canSend = value.trim().length > 0 || pendingFile !== null

  return (
    <>
    <div className="shrink-0 px-4 pb-4 pt-1">
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-mesh-border/60 border-l-2 border-l-mesh-green bg-mesh-bg-secondary px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <Reply className="h-3.5 w-3.5 shrink-0 text-mesh-green" />
          <span className="shrink-0 text-[11px] text-mesh-text-muted">Replying to</span>
          <span className="shrink-0 text-[11px] font-semibold text-mesh-green">{replyTo.senderName}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-mesh-text-muted">{replyTo.content.slice(0, 90)}</span>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={onCancelReply}
            className="mesh-icon-button mesh-pressable ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md text-mesh-text-muted transition-colors hover:bg-mesh-bg-hover hover:text-mesh-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Pending file preview */}
      {pendingFile && (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-mesh-bg-tertiary border border-mesh-border/50 p-2.5">
          {pendingFile.preview ? (
            <img src={pendingFile.preview} alt={pendingFile.name} className="h-12 w-12 rounded object-cover" />
          ) : (
            <div className="h-12 w-12 rounded bg-mesh-bg-primary flex items-center justify-center">
              <FileIcon className="h-5 w-5 text-mesh-green" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-mesh-text-primary truncate">{pendingFile.name}</p>
            <p className="text-[11px] text-mesh-text-muted">{formatFileSize(pendingFile.size)}</p>
          </div>
          <button
            type="button"
            aria-label="Remove attachment"
            onClick={() => setPendingFile(null)}
            className="shrink-0 p-1 rounded hover:bg-mesh-bg-hover text-mesh-text-muted hover:text-mesh-text-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {pasteError && <p className="mb-2 text-xs text-mesh-danger">{pasteError}</p>}

      <div className="flex items-end gap-2 rounded-xl bg-mesh-bg-tertiary border border-mesh-border/60 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] focus-within:border-mesh-green/50 focus-within:ring-1 focus-within:ring-mesh-green/25 transition-colors px-4 py-2.5">
        {/* Attachment button */}
        {onSendFile && (
          <button
            type="button"
            aria-label="Attach a file"
            onClick={handlePickFile}
            className="shrink-0 h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors mb-0.5"
            title="Attach a file"
          >
            <Paperclip className="h-5 w-5" />
          </button>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            adjustHeight()
            if (e.target.value.trim().length > 0) {
              emitTypingStart()
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onContextMenu={openContextMenu}
          onBlur={emitTypingStop}
          placeholder={`Message @${recipientName}`}
          rows={1}
          className="flex-1 bg-transparent text-sm text-mesh-text-primary placeholder:text-mesh-text-muted resize-none outline-none py-1.5 max-h-[120px] leading-relaxed"
        />

        {/* Send button */}
        {canSend && (
          <button
            type="button"
            aria-label="Send message"
            onClick={handleSend}
            className="shrink-0 h-8 w-8 rounded-md flex items-center justify-center transition-colors mb-0.5 bg-mesh-green text-white hover:bg-mesh-green/90"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
    {contextMenu && createPortal(
      <div
        ref={menuRef}
        role="menu"
        className="mesh-floating-surface fixed z-[260] w-[206px] rounded-lg border border-mesh-border/70 bg-mesh-bg-elevated/98 p-1.5 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-100"
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        {EDIT_MENU_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className={groupIndex > 0 ? 'mt-1 border-t border-mesh-border/60 pt-1' : undefined}>
            {group.map(({ command, label, shortcut, Icon, requiresSelection, requiresValue }) => {
              const disabled = (requiresSelection && !contextMenu.hasSelection) || (requiresValue && !contextMenu.hasValue)
              return (
                <button
                  key={command}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runEditCommand(command)}
                  className="mesh-context-menu-item flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-mesh-text-secondary transition-colors hover:bg-mesh-green hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-mesh-green/60 disabled:pointer-events-none disabled:opacity-35"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{label}</span>
                  <span className="font-mono text-[10px] opacity-55">{shortcut}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>,
      document.body
    )}
    </>
  )
}

export { MessageInput }
