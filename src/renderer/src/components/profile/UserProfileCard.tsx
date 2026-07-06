import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Check, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { useAvatarStore } from '@/stores/avatar.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useServersStore } from '@/stores/servers.store'
import { useMessagesStore } from '@/stores/messages.store'
import { useLiveStatus } from '@/lib/useLiveStatus'

/**
 * Discord-style user profile card: banner, avatar, identity, live status,
 * role chips (when a server context is given) and mutual servers. Used
 * docked on the right of a DM and as a popout from the member list.
 */
function UserProfileCard({
  userId,
  username,
  serverId,
  className,
  onAction
}: {
  userId: string
  username: string
  /** When set, shows the user's roles in that server. */
  serverId?: string
  className?: string
  /** Called after an action navigates away (lets popouts close themselves). */
  onAction?: () => void
}): JSX.Element {
  const navigate = useNavigate()
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)
  const friend = useFriendsStore((s) => s.friends.find((f) => f.userId === userId))
  const servers = useServersStore((s) => s.servers)
  const serverMembers = useServersStore((s) => s.serverMembers)
  const serverRoles = useServersStore((s) => s.serverRoles)
  const ensureConversation = useMessagesStore((s) => s.ensureConversationForFriend)
  const status = useLiveStatus(userId, 'offline')
  const [copied, setCopied] = useState(false)

  const isSelf = userId === selfId
  const avatarSrc = (isSelf ? selfAvatar : avatarsByUser[userId]) ?? undefined

  // Deterministic banner hue per user so profiles feel personal without
  // needing uploaded banners.
  const hue = [...userId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)

  // Servers this user and I share (roster-based).
  const mutualServers = servers.filter((sv) =>
    (serverMembers[sv.id] ?? []).some((m) => m.userId === userId)
  )

  // Role chips in the given server context.
  const contextMember = serverId ? (serverMembers[serverId] ?? []).find((m) => m.userId === userId) : undefined
  const contextRoles = serverId
    ? (serverRoles[serverId] ?? []).filter((r) => contextMember?.roleIds.includes(r.id))
    : []

  const statusLabel =
    status === 'online' ? 'Online' : status === 'idle' ? 'Idle' : status === 'dnd' ? 'Do Not Disturb' : 'Offline'
  const lastSeen =
    status === 'offline' && friend?.lastSeen
      ? formatLastSeen(friend.lastSeen)
      : null

  return (
    <div className={cn('flex flex-col bg-mesh-bg-secondary overflow-y-auto', className)}>
      {/* Banner */}
      <div
        className="h-24 shrink-0"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 45% 22%), hsl(${(hue + 40) % 360} 40% 12%))`
        }}
      />

      {/* Avatar overlapping the banner */}
      <div className="px-4 -mt-10">
        <div className="relative inline-block rounded-full ring-[5px] ring-mesh-bg-secondary">
          <Avatar fallback={username} size="xl" src={avatarSrc} />
          <span
            className={cn(
              'absolute bottom-0.5 right-0.5 rounded-full border-[3px] border-mesh-bg-secondary',
              status === 'online' ? 'bg-[#23a559]' : status === 'idle' ? 'bg-[#f0b232]' : 'bg-[#80848e]'
            )}
            style={{ height: 18, width: 18 }}
          />
        </div>
      </div>

      {/* Identity */}
      <div className="px-4 pt-2.5 pb-4 flex flex-col gap-3">
        <div>
          <h3 className="text-lg font-bold text-mesh-text-primary leading-tight truncate">
            {username}{isSelf ? ' (you)' : ''}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-mesh-text-secondary">{statusLabel}</span>
            {lastSeen && <span className="text-xs text-mesh-text-muted">· last seen {lastSeen}</span>}
          </div>
        </div>

        {/* User ID — this is how people add each other in MESH */}
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted mb-1">
            User ID
          </span>
          <div className="flex items-center gap-1.5 rounded-md bg-mesh-bg-tertiary border border-mesh-border px-2.5 py-1.5">
            <code className="flex-1 text-[11px] font-mono text-mesh-text-secondary truncate">{userId}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(userId)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="shrink-0 text-mesh-text-muted hover:text-mesh-text-primary transition-colors"
              title="Copy User ID"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Roles in the current server */}
        {serverId && contextMember && (
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted mb-1">
              Roles
            </span>
            <div className="flex flex-wrap gap-1.5">
              {contextRoles.length === 0 ? (
                <span className="text-[11px] text-mesh-text-muted">No roles</span>
              ) : (
                contextRoles.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-mesh-border bg-mesh-bg-tertiary px-2 py-0.5 text-[11px] text-mesh-text-secondary"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                    {r.name}
                  </span>
                ))
              )}
            </div>
          </div>
        )}

        {/* Mutual servers */}
        {!isSelf && mutualServers.length > 0 && (
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted mb-1">
              Mutual servers — {mutualServers.length}
            </span>
            <div className="flex flex-col gap-1">
              {mutualServers.slice(0, 4).map((sv) => (
                <button
                  key={sv.id}
                  onClick={() => { navigate(`/channels/${sv.id}`); onAction?.() }}
                  className="flex items-center gap-2 rounded-md px-2 py-1 -mx-2 text-left hover:bg-mesh-bg-tertiary transition-colors"
                >
                  <span
                    className="h-5 w-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                    style={{ backgroundColor: sv.iconColor }}
                  >
                    {sv.name[0]?.toUpperCase()}
                  </span>
                  <span className="text-xs text-mesh-text-secondary truncate">{sv.name}</span>
                </button>
              ))}
              {mutualServers.length > 4 && (
                <span className="text-[11px] text-mesh-text-muted px-0.5">
                  +{mutualServers.length - 4} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        {!isSelf && (
          <button
            onClick={async () => {
              await ensureConversation(userId)
              navigate(`/channels/@me/dm_${userId}`)
              onAction?.()
            }}
            className="flex items-center justify-center gap-2 h-9 rounded-md bg-mesh-green hover:bg-mesh-green-light text-white text-sm font-medium transition-colors mt-1"
          >
            <MessageSquare className="h-4 w-4" />
            Message
          </button>
        )}
      </div>
    </div>
  )
}

function formatLastSeen(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export { UserProfileCard }
