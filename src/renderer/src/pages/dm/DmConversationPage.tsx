import { useParams } from 'react-router-dom'
import { useEffect, useState, useRef, useCallback } from 'react'
import { MessageSquare, X, ShieldOff, UserPlus } from 'lucide-react'
import { useMessagesStore } from '@/stores/messages.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { MessageFeed } from '@/components/chat/MessageFeed'
import { MessageInput } from '@/components/chat/MessageInput'
import { Avatar } from '@/components/ui/Avatar'
import { webrtcManager } from '@/lib/webrtc'
import type { Message } from '@/types/messages'
import type { MessageRequestThreadMessage } from '@/types/social'

/**
 * Lightweight pub/sub for typing indicator events.
 * The global `handleIncomingPeerMessage` in messages.store.ts fires these
 * so that the active DM page can react without overriding onDataMessage.
 */
type TypingListener = (userId: string, typing: boolean) => void
const typingListeners = new Set<TypingListener>()

export function emitTypingEvent(userId: string, typing: boolean): void {
  for (const fn of typingListeners) fn(userId, typing)
}

function DmConversationPage(): JSX.Element {
  const { dmId } = useParams<{ dmId: string }>()
  const conversations = useMessagesStore((s) => s.conversations)
  const sendMessage = useMessagesStore((s) => s.sendMessage)
  const sendFileMessage = useMessagesStore((s) => s.sendFileMessage)
  const editMessage = useMessagesStore((s) => s.editMessage)
  const deleteMessage = useMessagesStore((s) => s.deleteMessage)
  const toggleReaction = useMessagesStore((s) => s.toggleReaction)
  const markAsRead = useMessagesStore((s) => s.markAsRead)
  const setActiveConversation = useMessagesStore((s) => s.setActiveConversation)
  const ensureConversationForFriend = useMessagesStore((s) => s.ensureConversationForFriend)
  const selfId = useIdentityStore((s) => s.identity?.userId)

  const messageRequests = useFriendsStore((s) => s.messageRequests)
  const loadMessageRequestThread = useFriendsStore((s) => s.loadMessageRequestThread)
  const replyMessageRequest = useFriendsStore((s) => s.replyMessageRequest)
  const blockFromMessageRequest = useFriendsStore((s) => s.blockFromMessageRequest)
  const sendFriendRequest = useFriendsStore((s) => s.sendFriendRequest)

  // Accept either a conversation id ("dm_usr_xxx") or a bare friend id ("usr_xxx").
  const normalizedId = dmId
    ? dmId.startsWith('dm_')
      ? dmId
      : `dm_${dmId}`
    : undefined
  const otherUserId = normalizedId ? normalizedId.replace(/^dm_/, '') : undefined
  const conversation = conversations.find((c) => c.id === normalizedId)
  const [autoCreateTried, setAutoCreateTried] = useState(false)

  // Find a pending message request for this user (only used when no conversation exists).
  const request = otherUserId
    ? messageRequests.find((r) => r.fromUserId === otherUserId || r.toUserId === otherUserId)
    : undefined

  useEffect(() => {
    if (!normalizedId || conversation || autoCreateTried || request) return
    setAutoCreateTried(true)
    ensureConversationForFriend(normalizedId).catch(() => {})
  }, [normalizedId, conversation, autoCreateTried, ensureConversationForFriend, request])

  // ── Reply state ──
  const [replyTarget, setReplyTarget] = useState<Message | null>(null)

  // ── Typing indicator state ──
  const [peerTyping, setPeerTyping] = useState(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const listener: TypingListener = (userId, typing) => {
      if (!conversation || userId !== conversation.recipientId) return
      if (typing) {
        setPeerTyping(true)
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
        typingTimerRef.current = setTimeout(() => setPeerTyping(false), 3000)
      } else {
        setPeerTyping(false)
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      }
    }
    typingListeners.add(listener)
    return () => {
      typingListeners.delete(listener)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [conversation])

  // Typing signal senders
  const handleTypingStart = useCallback(() => {
    if (!selfId || !conversation) return
    const payload = JSON.stringify({ type: 'typing:start', fromUserId: selfId })
    webrtcManager.sendDataMessage(conversation.recipientId, payload)
  }, [selfId, conversation])

  const handleTypingStop = useCallback(() => {
    if (!selfId || !conversation) return
    const payload = JSON.stringify({ type: 'typing:stop', fromUserId: selfId })
    webrtcManager.sendDataMessage(conversation.recipientId, payload)
  }, [selfId, conversation])

  // Join the DM signaling room exactly ONCE when this page mounts for a given
  // conversation, and leave exactly once when it unmounts or the DM changes.
  //
  // NOTE: do NOT depend on `conversation` here — that reference is recomputed
  // every time the messages store updates (which markAsRead itself triggers),
  // producing an infinite mount/unmount loop and a "Maximum update depth
  // exceeded" React crash. We only need `normalizedId` for correctness.
  useEffect(() => {
    if (!normalizedId) return
    setActiveConversation(normalizedId)
    markAsRead(normalizedId)
    window.api.signaling.emit('join-room', `dm:${normalizedId}`)
    return () => {
      setActiveConversation(null)
      window.api.signaling.emit('leave-room')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedId])

  // ── Message-request thread state (only used when no conversation exists) ──
  const [threadMessages, setThreadMessages] = useState<MessageRequestThreadMessage[]>([])
  const [requestError, setRequestError] = useState('')
  const threadScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (conversation || !request || !otherUserId) return
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const thread = await loadMessageRequestThread(otherUserId)
        if (!cancelled) setThreadMessages(thread)
      } catch { /* ignore */ }
    }
    refresh()
    const iv = setInterval(refresh, 2000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [conversation, request, otherUserId, loadMessageRequestThread])

  useEffect(() => {
    threadScrollRef.current?.scrollTo({ top: threadScrollRef.current.scrollHeight })
  }, [threadMessages])

  // ── Render: no conversation but a message request exists → DM-styled thread view
  if (!conversation && request && otherUserId) {
    const otherName = request.direction === 'incoming' ? request.fromUsername : (request.toUsername || otherUserId)
    const canSend =
      request.direction === 'incoming' ||
      (request.direction === 'outgoing' && request.status === 'replied')

    const handleSendReply = async (content: string): Promise<void> => {
      setRequestError('')
      const res = await replyMessageRequest(otherUserId, content)
      if (!res.success) setRequestError(res.error || 'Failed to send.')
      else {
        try {
          const thread = await loadMessageRequestThread(otherUserId)
          setThreadMessages(thread)
        } catch { /* ignore */ }
      }
    }

    return (
      <div className="flex flex-col h-full">
        {/* Header mirrors ChatHeader but with request actions */}
        <div className="flex items-center justify-between h-12 px-4 border-b border-mesh-border/50 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar fallback={otherName} size="sm" />
            <div className="min-w-0">
              <span className="text-sm font-semibold text-mesh-text-primary block truncate">
                {otherName}
              </span>
              <span className="text-[10px] text-mesh-text-muted font-mono">{otherUserId}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-mesh-info/20 text-mesh-info">
              Message Request
            </span>
            <button
              onClick={async () => {
                const res = await sendFriendRequest(otherUserId)
                if (!res.success) setRequestError(res.error || 'Could not send friend request.')
                else setRequestError('Friend request sent.')
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-mesh-green/20 text-mesh-green text-xs font-medium hover:bg-mesh-green hover:text-white transition-colors"
              title="Send Friend Request"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add Friend
            </button>
            <button
              onClick={() => blockFromMessageRequest(otherUserId, otherName)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-mesh-bg-elevated text-mesh-text-muted text-xs font-medium hover:bg-mesh-danger hover:text-white transition-colors"
              title="Block"
            >
              <ShieldOff className="h-3.5 w-3.5" />
              Block
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={threadScrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {threadMessages.length === 0 && (
            <p className="text-xs text-mesh-text-muted text-center py-6">No messages yet.</p>
          )}
          {threadMessages.map((m) => {
            const mine = m.senderId === selfId
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                    mine ? 'bg-mesh-green/20 text-mesh-text-primary' : 'bg-mesh-bg-tertiary text-mesh-text-primary'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <span className="text-[10px] text-mesh-text-muted mt-1 block">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Composer */}
        <div className="px-4 py-3 border-t border-mesh-border">
          {!canSend && (
            <p className="text-xs text-mesh-text-muted mb-2">
              Waiting for {otherName} to reply before you can send more messages.
            </p>
          )}
          {requestError && <p className="text-xs text-mesh-danger mb-2">{requestError}</p>}
          <RequestComposer disabled={!canSend} onSend={handleSendReply} recipientName={otherName} />
        </div>
      </div>
    )
  }

  if (!conversation) {
    // While the auto-create is in flight, show a tiny loading shell instead of
    // a "not found" message — the conversation will appear in the next render.
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="h-16 w-16 rounded-2xl bg-mesh-bg-tertiary flex items-center justify-center mb-4">
          <MessageSquare className="h-8 w-8 text-mesh-text-muted animate-pulse" />
        </div>
        <p className="text-sm text-mesh-text-muted">Opening conversation…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ChatHeader conversation={conversation} />
      <MessageFeed
        messages={conversation.messages}
        recipientName={conversation.recipientName}
        onEditMessage={(messageId, newContent) => editMessage(conversation.id, messageId, newContent)}
        onDeleteMessage={(messageId) => deleteMessage(conversation.id, messageId)}
        onToggleReaction={(messageId, emojiId) => toggleReaction(conversation.id, messageId, emojiId)}
        onReply={setReplyTarget}
      />

      {/* Typing indicator */}
      {peerTyping && (
        <div className="px-4 pb-1">
          <span className="text-xs italic text-mesh-text-muted inline-flex items-center gap-1">
            {conversation.recipientName} is typing
            <span className="inline-flex gap-0.5">
              <span className="h-1 w-1 rounded-full bg-mesh-text-muted inline-block animate-bounce [animation-delay:0ms]" />
              <span className="h-1 w-1 rounded-full bg-mesh-text-muted inline-block animate-bounce [animation-delay:150ms]" />
              <span className="h-1 w-1 rounded-full bg-mesh-text-muted inline-block animate-bounce [animation-delay:300ms]" />
            </span>
          </span>
        </div>
      )}

      {/* Reply banner */}
      {replyTarget && (
        <div className="mx-4 mb-1 flex items-center gap-2 rounded bg-mesh-bg-tertiary border-l-2 border-mesh-green px-3 py-1.5">
          <span className="text-[11px] text-mesh-text-muted shrink-0">Replying to</span>
          <span className="text-[11px] font-semibold text-mesh-green shrink-0">{replyTarget.senderName}</span>
          <span className="text-[11px] text-mesh-text-muted truncate flex-1">{replyTarget.content.slice(0, 60)}</span>
          <button
            onClick={() => setReplyTarget(null)}
            className="ml-auto shrink-0 text-mesh-text-muted hover:text-mesh-text-primary transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <MessageInput
        recipientName={conversation.recipientName}
        onSend={(content, replyTo) => {
          sendMessage(conversation.id, content, replyTo)
          setReplyTarget(null)
        }}
        onSendFile={(filePath) => sendFileMessage(conversation.id, filePath)}
        onTypingStart={handleTypingStart}
        onTypingStop={handleTypingStop}
        replyTo={replyTarget ? { messageId: replyTarget.id, senderName: replyTarget.senderName, content: replyTarget.content } : undefined}
      />
    </div>
  )
}

function RequestComposer({
  disabled,
  onSend,
  recipientName
}: {
  disabled: boolean
  onSend: (content: string) => void | Promise<void>
  recipientName: string
}): JSX.Element {
  const [value, setValue] = useState('')
  const handleSend = async (): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) return
    await onSend(trimmed)
    setValue('')
  }
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
          }
        }}
        disabled={disabled}
        placeholder={disabled ? 'Cannot send yet' : `Message @${recipientName}`}
        className="flex-1 h-10 px-3 rounded-lg bg-mesh-bg-tertiary border border-mesh-border text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-2 focus:ring-mesh-green disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="h-10 px-4 rounded-lg bg-mesh-green text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition"
      >
        Send
      </button>
    </div>
  )
}

export { DmConversationPage }
