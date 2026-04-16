import { useParams } from 'react-router-dom'
import { useEffect, useState, useRef, useCallback } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { useMessagesStore } from '@/stores/messages.store'
import { useIdentityStore } from '@/stores/identity.store'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { MessageFeed } from '@/components/chat/MessageFeed'
import { MessageInput } from '@/components/chat/MessageInput'
import { webrtcManager } from '@/lib/webrtc'
import type { Message } from '@/types/messages'

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

  // Accept either a conversation id ("dm_usr_xxx") or a bare friend id ("usr_xxx").
  const normalizedId = dmId
    ? dmId.startsWith('dm_')
      ? dmId
      : `dm_${dmId}`
    : undefined
  const conversation = conversations.find((c) => c.id === normalizedId)
  const [autoCreateTried, setAutoCreateTried] = useState(false)

  useEffect(() => {
    if (!normalizedId || conversation || autoCreateTried) return
    setAutoCreateTried(true)
    ensureConversationForFriend(normalizedId).catch(() => {})
  }, [normalizedId, conversation, autoCreateTried, ensureConversationForFriend])

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

  useEffect(() => {
    if (normalizedId) {
      setActiveConversation(normalizedId)
      markAsRead(normalizedId)

      // Request a P2P connection attempt to the recipient.
      // The signaling layer will route user-joined events and trigger WebRTC negotiation.
      // Data channel for P2P DM delivery is established in webrtcManager.createPeerConnection.
      if (conversation) {
        window.api.signaling.emit('join-room', `dm:${normalizedId}`)
      }
    }
    return () => {
      setActiveConversation(null)
      if (normalizedId) {
        window.api.signaling.emit('leave-room')
      }
    }
  }, [normalizedId, setActiveConversation, markAsRead, conversation])

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

export { DmConversationPage }
