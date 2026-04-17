import { X, ShieldOff, Mail } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useFriendsStore } from '@/stores/friends.store'
import { Avatar } from '@/components/ui/Avatar'

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function MessageRequestPanel(): JSX.Element {
  const messageRequests = useFriendsStore((s) => s.messageRequests)
  const { ignoreMessageRequest, blockFromMessageRequest } = useFriendsStore()
  const navigate = useNavigate()

  if (messageRequests.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
        <Mail className="h-16 w-16 text-mesh-text-muted mb-4 stroke-1" />
        <h3 className="text-lg font-semibold text-mesh-text-primary mb-2">No message requests</h3>
        <p className="text-sm text-mesh-text-muted max-w-xs text-center mb-8">
          Cold messages from non-friends will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 px-3">
      <div className="px-3 pb-2">
        <span className="text-[11px] font-semibold text-mesh-text-muted uppercase tracking-wide">
          Message Requests — {messageRequests.length}
        </span>
      </div>

      {messageRequests.map((req) => {
        const otherId = req.direction === 'incoming' ? req.fromUserId : req.toUserId
        const otherName = req.direction === 'incoming' ? req.fromUsername : (req.toUsername || req.toUserId)
        const statusLabel =
          req.direction === 'outgoing'
            ? req.status === 'replied' ? 'Replied' : 'Pending'
            : req.status === 'ignored' ? 'Ignored' : 'New'
        return (
          <button
            key={req.id}
            onClick={() => navigate(`/channels/@me/dm_${otherId}`)}
            className="flex flex-col gap-2 px-3 py-3 rounded-lg bg-mesh-bg-tertiary/40 hover:bg-mesh-bg-tertiary/70 transition-colors text-left"
          >
            <div className="flex items-center gap-2.5">
              <Avatar fallback={otherName} size="sm" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-mesh-text-primary truncate block">{otherName}</span>
                <span className="text-[10px] text-mesh-text-muted font-mono">
                  {req.direction === 'outgoing' ? 'To ' : 'From '}
                  {otherId}
                </span>
              </div>
              <span
                className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                  statusLabel === 'Replied'
                    ? 'bg-mesh-green/20 text-mesh-green'
                    : statusLabel === 'Ignored'
                      ? 'bg-mesh-bg-elevated text-mesh-text-muted'
                      : 'bg-mesh-info/20 text-mesh-info'
                }`}
              >
                {statusLabel}
              </span>
              <span className="text-[10px] text-mesh-text-muted shrink-0">{formatTime(req.timestamp)}</span>
            </div>

            <p className="text-sm text-mesh-text-secondary pl-10 line-clamp-2">{req.messagePreview}</p>

            {req.direction === 'incoming' && req.status !== 'ignored' && (
              <div className="flex items-center gap-2 pl-10 pt-1">
                <span className="text-xs text-mesh-text-muted">Click to open · or</span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    ignoreMessageRequest(req.id)
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-mesh-bg-elevated text-mesh-text-muted text-xs font-medium hover:bg-mesh-bg-hover hover:text-mesh-text-primary transition-colors cursor-pointer"
                >
                  <X className="h-3 w-3" /> Ignore
                </span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    blockFromMessageRequest(otherId, otherName)
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-mesh-bg-elevated text-mesh-text-muted text-xs font-medium hover:bg-mesh-danger hover:text-white transition-colors cursor-pointer"
                >
                  <ShieldOff className="h-3 w-3" /> Block
                </span>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

export { MessageRequestPanel }
