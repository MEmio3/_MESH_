import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Search, MessageSquare, Mail } from 'lucide-react'
import { useMessagesStore } from '@/stores/messages.store'
import { useFriendsStore } from '@/stores/friends.store'
import { DmListItem } from './DmListItem'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import type { Conversation } from '@/types/messages'
import type { MessageRequest } from '@/types/social'

function DmList(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const conversations = useMessagesStore((s) => s.conversations)
  const messageRequests = useFriendsStore((s) => s.messageRequests)
  const [search, setSearch] = useState('')

  // Build a set of conversation-peer ids so a message request that has already
  // been promoted (replied → full DM) doesn't show up twice.
  const conversationPeerIds = useMemo(
    () => new Set(conversations.map((c) => c.recipientId)),
    [conversations]
  )

  // Surface pending message requests directly in the DM list per spec —
  // everything that would have lived in a separate "Requests" section now
  // appears here. We drop 'replied' (already a real conversation) and
  // 'ignored' (user chose to hide it).
  const visibleRequests = useMemo(
    () =>
      messageRequests.filter((r) => {
        if (r.status === 'replied' || r.status === 'ignored') return false
        const otherId = r.direction === 'incoming' ? r.fromUserId : r.toUserId
        if (conversationPeerIds.has(otherId)) return false
        const otherName = r.direction === 'incoming' ? r.fromUsername : (r.toUsername || '')
        const term = search.toLowerCase()
        return !term || otherName.toLowerCase().includes(term)
      }),
    [messageRequests, conversationPeerIds, search]
  )

  // Sort by last message time (most recent first)
  const sorted = [...conversations]
    .filter((c) => c.recipientName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aTime = a.lastMessage?.timestamp ?? 0
      const bTime = b.lastMessage?.timestamp ?? 0
      return bTime - aTime
    })

  const hasAnything = sorted.length > 0 || visibleRequests.length > 0

  return (
    <div className="flex flex-col">
      {/* Search */}
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-mesh-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find or start a conversation"
            className="w-full h-8 pl-8 pr-2 rounded bg-mesh-bg-tertiary text-xs text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border border-none"
          />
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 mt-2">
        <span className="text-[11px] font-semibold text-mesh-text-muted uppercase tracking-wide">
          DIRECT MESSAGES
        </span>
      </div>

      {/* List: pending message requests first (so incoming stuff is visible),
          then real conversations underneath. */}
      <div className="flex flex-col gap-0.5 pt-1 pb-2">
        {visibleRequests.map((req) => (
          <RequestListItem
            key={req.id}
            request={req}
            location={location.pathname}
            onClick={(peerId) => navigate(`/channels/@me/dm_${peerId}`)}
          />
        ))}

        {sorted.map((conv) => (
          <DmListItem
            key={conv.id}
            conversation={conv}
            isActive={location.pathname === `/channels/@me/${conv.id}`}
            onClick={() => navigate(`/channels/@me/${conv.id}`)}
          />
        ))}

        {!hasAnything && (
          <div className="flex flex-col items-center justify-center mt-8 text-center px-4">
            <MessageSquare className="h-8 w-8 text-mesh-text-muted mb-3 stroke-1" />
            <h3 className="text-sm font-semibold text-mesh-text-primary mb-1">
              No conversations
            </h3>
            <p className="text-xs text-mesh-text-muted max-w-[150px]">
              {search ? 'No matches found' : 'Find or start a conversation'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Message-request row styled to match DmListItem so pending requests sit
 * naturally inside the DM sidebar instead of living in a separate panel.
 * Clicking it opens the thread view (DmConversationPage already knows how to
 * render a request thread when there's no conversation yet). A small
 * "Request" badge distinguishes it from a regular DM.
 */
function RequestListItem({
  request,
  location,
  onClick
}: {
  request: MessageRequest
  location: string
  onClick: (otherUserId: string) => void
}): JSX.Element {
  const incoming = request.direction === 'incoming'
  const otherUserId = incoming ? request.fromUserId : request.toUserId
  const otherName = incoming ? request.fromUsername : (request.toUsername || otherUserId)
  const isActive = location === `/channels/@me/dm_${otherUserId}`

  return (
    <button
      onClick={() => onClick(otherUserId)}
      className={cn(
        'group flex items-center gap-2.5 mx-1.5 px-2 h-11 rounded-md text-left transition-colors duration-100',
        isActive
          ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
          : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60 hover:text-mesh-text-primary'
      )}
      title={incoming ? 'Message request — click to open and reply' : 'Pending outgoing message request'}
    >
      <Avatar fallback={otherName} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-col">
          <span className={cn(
            'text-sm truncate',
            isActive ? 'text-mesh-text-primary font-medium' : 'text-mesh-text-secondary group-hover:text-mesh-text-primary'
          )}>
            {otherName}
          </span>
          <p className="text-xs text-mesh-text-muted truncate">
            {request.messagePreview || (incoming ? 'New message request' : 'Waiting for reply…')}
          </p>
        </div>
      </div>

      <div className="flex items-center shrink-0 gap-1.5">
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-mesh-info/20 text-mesh-info">
          <Mail className="h-2.5 w-2.5" />
          {incoming ? 'Request' : 'Pending'}
        </span>
      </div>
    </button>
  )
}

export { DmList }
