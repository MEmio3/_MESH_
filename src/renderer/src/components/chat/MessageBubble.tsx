import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, Clock, Trash2, Reply, Pencil, SmilePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import type { Message } from '@/types/messages'
import { FileAttachmentDisplay } from './FileAttachment'
import { ReactionPicker } from './ReactionPicker'
import { ReactionBar } from './ReactionBar'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'

/** Delivery status indicator for own messages (Task 9). */
function StatusTick({ status }: { status: Message['status'] }): JSX.Element | null {
  if (status === 'sending') return <Clock className="h-3 w-3 text-mesh-text-muted" />
  if (status === 'sent') return <Check className="h-3 w-3 text-mesh-text-muted" />
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 text-mesh-text-muted" />
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-mesh-green" />
  return null
}

interface MessageBubbleProps {
  message: Message
  isGrouped: boolean
  isOwnMessage: boolean
  /** Whether the caller can delete this message (sender or mod/host on servers). */
  canDelete?: boolean
  onEdit?: (messageId: string, newContent: string) => void
  onDelete?: (messageId: string) => void
  onToggleReaction?: (messageId: string, emojiId: string) => void
  onReply?: (message: Message) => void
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function EditedTag({ editedAt }: { editedAt: number }): JSX.Element {
  return (
    <span
      className="text-[10px] text-mesh-text-muted ml-1.5"
      title={`Edited ${new Date(editedAt).toLocaleString()}`}
    >
      (edited)
    </span>
  )
}

function DeletedPlaceholder(): JSX.Element {
  return (
    <p className="text-sm italic text-mesh-text-muted leading-relaxed">
      Message deleted
    </p>
  )
}

interface InlineEditorProps {
  initial: string
  onSave: (newContent: string) => void
  onCancel: () => void
}

function InlineEditor({ initial, onSave, onCancel }: InlineEditorProps): JSX.Element {
  const [value, setValue] = useState(initial)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = ta.value.length
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`
    }
  }, [])

  function submit(): void {
    const trimmed = value.trim()
    if (!trimmed || trimmed === initial) {
      onCancel()
      return
    }
    onSave(trimmed)
  }

  return (
    <div className="mt-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          const ta = e.currentTarget
          ta.style.height = 'auto'
          ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="w-full resize-none rounded-md bg-mesh-bg-tertiary text-sm text-mesh-text-primary leading-relaxed px-3 py-2 focus:outline-none focus:ring-1 focus:ring-mesh-green"
      />
      <div className="mt-1 flex items-center gap-2 text-[10px] text-mesh-text-muted">
        <span>
          escape to{' '}
          <button onClick={onCancel} className="text-mesh-info hover:underline">
            cancel
          </button>
        </span>
        <span>·</span>
        <span>
          enter to{' '}
          <button onClick={submit} className="text-mesh-green hover:underline">
            save
          </button>
        </span>
      </div>
    </div>
  )
}

function MessageBubble({ message, isGrouped, isOwnMessage, canDelete, onEdit, onDelete, onToggleReaction, onReply }: MessageBubbleProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const pickerBtnRef = useRef<HTMLButtonElement>(null)
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfAvatar = useAvatarStore((s) => s.self)
  const peerAvatar = useAvatarStore((s) => s.byUser[message.senderId])
  const ensureFor = useAvatarStore((s) => s.ensureFor)
  const senderAvatarSrc = isOwnMessage ? selfAvatar : peerAvatar

  useEffect(() => {
    if (!isOwnMessage && peerAvatar === undefined) {
      ensureFor(message.senderId).catch(() => {})
    }
  }, [isOwnMessage, peerAvatar, message.senderId, ensureFor])

  const canEdit = isOwnMessage && !message.file && !message.isDeleted && !!onEdit
  const allowDelete = !message.isDeleted && !!onDelete && (canDelete ?? isOwnMessage)

  const commitEdit = (next: string): void => {
    onEdit?.(message.id, next)
    setIsEditing(false)
  }

  const commitDelete = (): void => {
    if (!allowDelete) return
    onDelete?.(message.id)
  }

  function renderBody(): JSX.Element {
    if (message.isDeleted) return <DeletedPlaceholder />

    const replyQuote = message.replyTo ? (
      <div className="mb-1.5 flex items-start gap-1.5 pl-2 border-l-2 border-mesh-green/60 rounded-sm bg-mesh-bg-tertiary/50 py-1 pr-2">
        <span className="font-semibold text-[11px] text-mesh-green shrink-0">{message.replyTo.senderName}</span>
        <span className="text-[11px] text-mesh-text-muted truncate">{message.replyTo.content.slice(0, 80)}</span>
      </div>
    ) : null

    if (isEditing) {
      return (
        <>
          {replyQuote}
          <InlineEditor initial={message.content} onSave={commitEdit} onCancel={() => setIsEditing(false)} />
        </>
      )
    }
    if (message.file) {
      return (
        <>
          {replyQuote}
          <FileAttachmentDisplay file={message.file} isOwnMessage={isOwnMessage} />
        </>
      )
    }
    // Inline data-URL image (used by server channels for media preview)
    if (message.content.startsWith('data:image/')) {
      return (
        <>
          {replyQuote}
          <div className="mt-1 max-w-sm">
            <img
              src={message.content}
              alt="attachment"
              className="rounded-lg max-h-[300px] w-auto object-contain border border-mesh-border/30 cursor-pointer"
              onClick={() => window.open(message.content, '_blank')}
            />
            {message.editedAt ? <EditedTag editedAt={message.editedAt} /> : null}
          </div>
        </>
      )
    }
    return (
      <>
        {replyQuote}
        <p className="text-sm text-mesh-text-primary leading-relaxed break-words">
          {message.content}
          {message.editedAt ? <EditedTag editedAt={message.editedAt} /> : null}
        </p>
      </>
    )
  }

  if (isGrouped) {
    return (
      <div className="group relative flex items-start gap-3 px-4 py-0.5 hover:bg-mesh-bg-tertiary/30 transition-colors">
        {/* Floating action bar */}
        {!message.isDeleted && (
          <div className="absolute -top-3 right-4 opacity-0 group-hover:opacity-100 transition-opacity bg-mesh-bg-elevated border border-mesh-border rounded-md shadow-md flex items-center p-0.5 z-10">
            <button onClick={() => onReply?.(message)} className="w-7 h-7 rounded flex items-center justify-center text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary transition-colors" title="Reply">
              <Reply className="h-4 w-4" />
            </button>
            {!!onToggleReaction && (
              <div className="relative flex items-center justify-center">
                <button
                  ref={pickerBtnRef}
                  onClick={() => setShowPicker(!showPicker)}
                  className="w-7 h-7 rounded flex items-center justify-center text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary transition-colors cursor-pointer"
                  title="Add Reaction"
                >
                  <SmilePlus className="h-4 w-4" />
                </button>
                {showPicker && (
                  <ReactionPicker
                    anchorRef={pickerBtnRef}
                    onSelect={(emojiId) => onToggleReaction(message.id, emojiId)}
                    onClose={() => setShowPicker(false)}
                  />
                )}
              </div>
            )}
            {canEdit && (
              <button
                onClick={() => setIsEditing(true)}
                className="w-7 h-7 rounded flex items-center justify-center text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary transition-colors cursor-pointer"
                title="Edit Message"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {allowDelete && (
              <button
                onClick={commitDelete}
                className="w-7 h-7 rounded flex items-center justify-center text-mesh-text-secondary hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
                title="Delete Message"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <div className="w-10 shrink-0 flex items-center justify-end">
          <span className="text-[10px] text-mesh-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(message.timestamp)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          {renderBody()}
          {!message.isDeleted && message.reactions && selfId && onToggleReaction && (
            <ReactionBar
              reactions={message.reactions}
              selfId={selfId}
              onToggle={(emojiId) => onToggleReaction(message.id, emojiId)}
            />
          )}
        </div>
        {isOwnMessage && !message.isDeleted && (
          <span className="shrink-0 pt-1" title={message.status}>
            <StatusTick status={message.status} />
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="group relative flex items-start gap-3 px-4 pt-4 pb-0.5 hover:bg-mesh-bg-tertiary/30 transition-colors mt-[17px]">
      {!message.isDeleted && (
        <div className="absolute -top-3 right-4 opacity-0 group-hover:opacity-100 transition-opacity bg-mesh-bg-elevated border border-mesh-border rounded-md shadow-md flex items-center p-0.5 z-10 w-fit">
          <button onClick={() => onReply?.(message)} className="w-7 h-7 rounded flex items-center justify-center text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary transition-colors" title="Reply">
            <Reply className="h-4 w-4" />
          </button>
          {!!onToggleReaction && (
            <div className="relative flex items-center justify-center">
              <button
                onClick={() => setShowPicker(!showPicker)}
                className="w-7 h-7 rounded flex items-center justify-center text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary transition-colors cursor-pointer"
                title="Add Reaction"
              >
                <SmilePlus className="h-4 w-4" />
              </button>
              {showPicker && (
                <ReactionPicker
                  onSelect={(emojiId) => onToggleReaction(message.id, emojiId)}
                  onClose={() => setShowPicker(false)}
                />
              )}
            </div>
          )}
          {canEdit && (
            <button
              onClick={() => setIsEditing(true)}
              className="w-7 h-7 rounded flex items-center justify-center text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary transition-colors cursor-pointer"
              title="Edit Message"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {allowDelete && (
            <button
              onClick={commitDelete}
              className="w-7 h-7 rounded flex items-center justify-center text-mesh-text-secondary hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
              title="Delete Message"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      <div className="w-10 shrink-0 pt-0.5">
        <Avatar src={senderAvatarSrc} fallback={message.senderName} size="md" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn(
            'text-sm font-semibold',
            isOwnMessage ? 'text-mesh-green' : 'text-mesh-text-primary'
          )}>
            {message.senderName}
          </span>
          <span className="text-[10px] text-mesh-text-muted">
            {formatFullTime(message.timestamp)}
          </span>
        </div>
        {renderBody()}
        {!message.isDeleted && message.reactions && selfId && onToggleReaction && (
          <ReactionBar
            reactions={message.reactions}
            selfId={selfId}
            onToggle={(emojiId) => onToggleReaction(message.id, emojiId)}
          />
        )}
        {isOwnMessage && !message.isDeleted && (
          <span className="inline-flex align-middle ml-1.5" title={message.status}>
            <StatusTick status={message.status} />
          </span>
        )}
      </div>
    </div>
  )
}

function formatFullTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (isToday) return `Today at ${time}`
  if (isYesterday) return `Yesterday at ${time}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} at ${time}`
}

export { MessageBubble }
