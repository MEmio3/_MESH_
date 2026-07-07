import { forwardRef, useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, Clock, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import type { Message } from '@/types/messages'
import { FileAttachmentDisplay } from './FileAttachment'
import { ReactionPicker } from './ReactionPicker'
import { ReactionBar } from './ReactionBar'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'

function StatusTick({ status }: { status: Message['status'] }): JSX.Element | null {
  if (status === 'sending') return <Clock className="mesh-status-pending h-3 w-3 text-mesh-text-muted" />
  if (status === 'sent') return <Check className="h-3 w-3 text-mesh-text-muted" />
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 text-mesh-text-muted" />
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-mesh-green" />
  return null
}

interface MessageBubbleProps {
  message: Message
  isGrouped: boolean
  isOwnMessage: boolean
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
      className="ml-1.5 text-[10px] font-medium text-mesh-text-muted"
      title={`Edited ${new Date(editedAt).toLocaleString()}`}
    >
      edited
    </span>
  )
}

function DeletedPlaceholder(): JSX.Element {
  return (
    <p className="inline-flex rounded-lg border border-mesh-border/50 bg-mesh-bg-tertiary/35 px-2.5 py-1.5 text-sm italic leading-relaxed text-mesh-text-muted">
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
    <div className="mt-1.5 rounded-xl border border-mesh-border/70 bg-mesh-bg-tertiary/45 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
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
        className="w-full resize-none rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/45 px-3 py-2 text-sm leading-relaxed text-mesh-text-primary outline-none transition focus:border-mesh-green focus:ring-1 focus:ring-mesh-green/30"
      />
      <div className="mt-1.5 flex items-center gap-2 px-1 text-[10px] text-mesh-text-muted">
        <button onClick={onCancel} className="font-medium text-mesh-text-secondary hover:text-mesh-text-primary">
          Esc cancel
        </button>
        <span>-</span>
        <button onClick={submit} className="font-medium text-mesh-green hover:text-mesh-green-light">
          Enter save
        </button>
      </div>
    </div>
  )
}

function MessageActionBar({
  message,
  canEdit,
  allowDelete,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction
}: {
  message: Message
  canEdit: boolean
  allowDelete: boolean
  onReply?: (message: Message) => void
  onEdit: () => void
  onDelete: () => void
  onToggleReaction?: (messageId: string, emojiId: string) => void
}): JSX.Element | null {
  const [showPicker, setShowPicker] = useState(false)
  const pickerBtnRef = useRef<HTMLButtonElement>(null)

  if (message.isDeleted) return null

  return (
    <div className="mesh-action-pop absolute -top-3 right-5 z-10 flex items-center rounded-lg border border-mesh-border/70 bg-mesh-bg-elevated/95 p-0.5 opacity-0 shadow-[0_12px_30px_rgba(0,0,0,0.38)] backdrop-blur transition-opacity group-hover:opacity-100">
      <ActionButton onClick={() => onReply?.(message)} title="Reply">
        <Reply className="h-4 w-4" />
      </ActionButton>
      {!!onToggleReaction && (
        <div className="relative flex items-center justify-center">
          <ActionButton
            ref={pickerBtnRef}
            onClick={() => setShowPicker((value) => !value)}
            title="Add Reaction"
          >
            <SmilePlus className="h-4 w-4" />
          </ActionButton>
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
        <ActionButton onClick={onEdit} title="Edit Message">
          <Pencil className="h-4 w-4" />
        </ActionButton>
      )}
      {allowDelete && (
        <ActionButton danger onClick={onDelete} title="Delete Message">
          <Trash2 className="h-4 w-4" />
        </ActionButton>
      )}
    </div>
  )
}

const ActionButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }>(
  ({ danger, className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'mesh-pressable grid h-7 w-7 place-items-center rounded-md text-mesh-text-secondary transition-colors hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary',
        danger && 'hover:bg-red-500/10 hover:text-red-400',
        className
      )}
      {...props}
    />
  )
)
ActionButton.displayName = 'ActionButton'

function ReplyQuote({ message }: { message: Message }): JSX.Element | null {
  if (!message.replyTo) return null
  return (
    <div className="mesh-reveal-in mb-1.5 flex max-w-2xl items-start gap-2 rounded-lg border border-mesh-border/45 bg-mesh-bg-tertiary/35 px-2.5 py-1.5">
      <span className="mt-0.5 h-4 w-0.5 shrink-0 rounded-full bg-mesh-green" />
      <span className="shrink-0 text-[11px] font-semibold text-mesh-green">{message.replyTo.senderName}</span>
      <span className="min-w-0 truncate text-[11px] text-mesh-text-muted">{message.replyTo.content.slice(0, 90)}</span>
    </div>
  )
}

function MessageBubble({ message, isGrouped, isOwnMessage, canDelete, onEdit, onDelete, onToggleReaction, onReply }: MessageBubbleProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
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

    const replyQuote = <ReplyQuote message={message} />

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
    if (message.content.startsWith('data:image/')) {
      return (
        <>
          {replyQuote}
          <div className="mt-1 max-w-sm">
            <img
              src={message.content}
              alt="attachment"
              className="max-h-[300px] w-auto cursor-pointer rounded-xl border border-mesh-border/55 object-contain shadow-[0_12px_32px_rgba(0,0,0,0.26)]"
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
        <p className="max-w-3xl break-words text-sm leading-relaxed text-mesh-text-primary">
          {message.content}
          {message.editedAt ? <EditedTag editedAt={message.editedAt} /> : null}
        </p>
      </>
    )
  }

  const actions = (
    <MessageActionBar
      message={message}
      canEdit={canEdit}
      allowDelete={allowDelete}
      onReply={onReply}
      onEdit={() => setIsEditing(true)}
      onDelete={commitDelete}
      onToggleReaction={onToggleReaction}
    />
  )

  if (isGrouped) {
    return (
      <div className="mesh-message-enter group relative flex items-start gap-3 px-4 py-1 transition-colors hover:bg-mesh-bg-tertiary/20">
        {actions}
        <div className="flex w-10 shrink-0 items-center justify-end">
          <span className="rounded px-1.5 py-0.5 text-[10px] text-mesh-text-muted opacity-0 transition-opacity group-hover:opacity-100">
            {formatTime(message.timestamp)}
          </span>
        </div>
        <div className="min-w-0 flex-1 rounded-lg px-0.5">
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
    <div className="mesh-message-enter group relative mt-3 flex items-start gap-3 px-4 pb-1.5 pt-3 transition-colors hover:bg-mesh-bg-tertiary/20">
      {actions}
      <div className="w-10 shrink-0 pt-0.5">
        <div className={cn('rounded-full', isOwnMessage && 'ring-2 ring-mesh-green/35 ring-offset-2 ring-offset-mesh-bg-secondary')}>
          <Avatar src={senderAvatarSrc} fallback={message.senderName} size="md" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex min-w-0 items-baseline gap-2">
          <span className={cn(
            'truncate text-sm font-semibold',
            isOwnMessage ? 'text-mesh-green' : 'text-mesh-text-primary'
          )}>
            {message.senderName}
          </span>
          <span className="shrink-0 text-[10px] text-mesh-text-muted">
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
          <span className="ml-1.5 inline-flex align-middle" title={message.status}>
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
