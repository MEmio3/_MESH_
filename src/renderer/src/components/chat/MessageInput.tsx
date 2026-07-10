import { useState, useRef, useCallback, useEffect } from 'react'
import { SendHorizontal, Paperclip, X, FileIcon } from 'lucide-react'

interface PendingFile {
  path: string
  name: string
  size: number
  type: string
  preview?: string // data URL for images
}

interface ReplyContext {
  messageId: string
  senderName: string
  content: string
}

interface MessageInputProps {
  recipientName: string
  onSend: (content: string, replyTo?: ReplyContext) => void
  onSendFile?: (filePath: string) => void
  onTypingStart?: () => void
  onTypingStop?: () => void
  replyTo?: ReplyContext
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MessageInput({ recipientName, onSend, onSendFile, onTypingStart, onTypingStop, replyTo }: MessageInputProps): JSX.Element {
  const [value, setValue] = useState('')
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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
  }

  const canSend = value.trim().length > 0 || pendingFile !== null

  return (
    <div className="shrink-0 px-4 pb-4 pt-1">
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
            onClick={() => setPendingFile(null)}
            className="shrink-0 p-1 rounded hover:bg-mesh-bg-hover text-mesh-text-muted hover:text-mesh-text-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-xl bg-mesh-bg-tertiary border border-mesh-border/60 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] focus-within:border-mesh-green/50 focus-within:ring-1 focus-within:ring-mesh-green/25 transition-colors px-4 py-2.5">
        {/* Attachment button */}
        {onSendFile && (
          <button
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
          onBlur={emitTypingStop}
          placeholder={`Message @${recipientName}`}
          rows={1}
          className="flex-1 bg-transparent text-sm text-mesh-text-primary placeholder:text-mesh-text-muted resize-none outline-none py-1.5 max-h-[120px] leading-relaxed"
        />

        {/* Send button */}
        {canSend && (
          <button
            onClick={handleSend}
            className="shrink-0 h-8 w-8 rounded-md flex items-center justify-center transition-colors mb-0.5 bg-mesh-green text-white hover:bg-mesh-green/90"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

export { MessageInput }
