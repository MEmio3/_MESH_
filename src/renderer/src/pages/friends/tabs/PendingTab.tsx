import { Check, X, UserCheck } from 'lucide-react'
import { useFriendsStore } from '@/stores/friends.store'
import { Avatar } from '@/components/ui/Avatar'

function PendingTab(): JSX.Element {
  const friendRequests = useFriendsStore((s) => s.friendRequests)
  const { acceptRequest, declineRequest, cancelRequest } = useFriendsStore()

  const incoming = friendRequests.filter((r) => r.direction === 'incoming')
  const outgoing = friendRequests.filter((r) => r.direction === 'outgoing')

  const formatTime = (ts: number): string => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="flex flex-col gap-6 px-3">
      {/* Incoming */}
      {incoming.length > 0 && (
        <div>
          <div className="px-3 pb-2">
            <span className="text-[11px] font-semibold text-mesh-text-muted uppercase tracking-wide">
              Incoming — {incoming.length}
            </span>
          </div>
          {incoming.map((req) => (
            <div
              key={req.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-mesh-bg-tertiary/60 transition-colors"
            >
              <Avatar fallback={req.fromUsername} size="md" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-mesh-text-primary block truncate">
                  {req.fromUsername}
                </span>
                <span className="text-xs text-mesh-text-muted">
                  Incoming Friend Request · {formatTime(req.timestamp)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => acceptRequest(req.id)}
                  className="h-9 w-9 rounded-full flex items-center justify-center bg-mesh-green/20 text-mesh-green hover:bg-mesh-green hover:text-white transition-colors"
                >
                  <Check className="h-4.5 w-4.5" />
                </button>
                <button
                  onClick={() => declineRequest(req.id)}
                  className="h-9 w-9 rounded-full flex items-center justify-center bg-mesh-bg-elevated text-mesh-text-muted hover:bg-mesh-danger hover:text-white transition-colors"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Outgoing */}
      {outgoing.length > 0 && (
        <div>
          <div className="px-3 pb-2">
            <span className="text-[11px] font-semibold text-mesh-text-muted uppercase tracking-wide">
              Outgoing — {outgoing.length}
            </span>
          </div>
          {outgoing.map((req) => {
            const displayName = req.toUsername || req.toUserId
            return (
            <div
              key={req.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-mesh-bg-tertiary/60 transition-colors"
            >
              <Avatar fallback={displayName} size="md" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-mesh-text-primary block truncate font-mono">
                  {displayName}
                </span>
                <span className="text-xs text-mesh-text-muted">
                  Outgoing Friend Request · {formatTime(req.timestamp)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Accept is always available — if the other user already sent
                    us one, this auto-promotes both sides to friend. If not,
                    it's a no-op re-send (the outgoing row stays as-is). */}
                <button
                  onClick={() => acceptRequest(req.id)}
                  className="h-9 w-9 rounded-full flex items-center justify-center bg-mesh-green/20 text-mesh-green hover:bg-mesh-green hover:text-white transition-colors"
                  title="Accept"
                >
                  <Check className="h-4.5 w-4.5" />
                </button>
                <button
                  onClick={() => cancelRequest(req.id)}
                  className="h-9 w-9 rounded-full flex items-center justify-center bg-mesh-bg-elevated text-mesh-text-muted hover:bg-mesh-danger hover:text-white transition-colors"
                  title="Cancel"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {/* Empty State */}
      {incoming.length === 0 && outgoing.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
          <UserCheck className="h-16 w-16 text-mesh-text-muted mb-4 stroke-1" />
          <h3 className="text-lg font-semibold text-mesh-text-primary mb-2">No pending requests</h3>
          <p className="text-sm text-mesh-text-muted max-w-xs text-center mb-8">
            There are no pending friend requests at this time.
          </p>
        </div>
      )}
    </div>
  )
}

export { PendingTab }
