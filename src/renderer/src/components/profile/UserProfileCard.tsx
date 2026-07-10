import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, MessageSquare, Server, Shield, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { ServerAvatar } from '@/components/ui/ServerAvatar'
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
  const statusDotClass =
    status === 'online'
      ? 'bg-[#23a559] shadow-[0_0_14px_rgba(35,165,89,0.75)]'
      : status === 'idle'
        ? 'bg-[#f0b232] shadow-[0_0_14px_rgba(240,178,50,0.65)]'
        : status === 'dnd'
          ? 'bg-[#f23f43] shadow-[0_0_14px_rgba(242,63,67,0.65)]'
          : 'bg-[#80848e]'
  const bannerStyle = {
    background: `
      radial-gradient(circle at 18% 18%, hsl(${(hue + 24) % 360} 96% 72% / 0.62), transparent 30%),
      radial-gradient(circle at 78% 8%, hsl(${(hue + 145) % 360} 88% 62% / 0.46), transparent 34%),
      linear-gradient(135deg, hsl(${hue} 56% 30%), hsl(${(hue + 42) % 360} 56% 13%) 58%, hsl(${(hue + 96) % 360} 58% 10%))
    `
  }
  const accentStyle = {
    background: `linear-gradient(135deg, hsl(${hue} 92% 66%), hsl(${(hue + 84) % 360} 92% 63%))`
  }
  const roleSummary = contextRoles.length > 0 ? `${contextRoles.length}` : 'None'

  const copyUserId = (): void => {
    navigator.clipboard.writeText(userId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className={cn(
        'flex flex-col overflow-y-auto bg-mesh-bg-secondary text-mesh-text-primary',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        className
      )}
    >
      <div className="relative h-28 shrink-0 overflow-hidden" style={bannerStyle}>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),transparent_42%,rgba(0,0,0,0.34))]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-white/15" />
        <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80 shadow-lg backdrop-blur-md">
          <Sparkles className="h-3 w-3" />
          Profile
        </div>
      </div>

      <div className="px-4 -mt-12">
        <div className="relative inline-flex rounded-full">
          <span
            className="absolute -inset-1.5 rounded-full opacity-70 blur-md"
            style={accentStyle}
          />
          <div className="relative rounded-full bg-mesh-bg-secondary p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.42)]">
            <Avatar fallback={username} size="xl" src={avatarSrc} />
            <span
              className={cn(
                'absolute bottom-1 right-1 h-[18px] w-[18px] rounded-full border-[4px] border-mesh-bg-secondary',
                statusDotClass
              )}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-4 pt-2.5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-xl font-bold leading-tight text-mesh-text-primary">
              {username}
            </h3>
            {isSelf && (
              <span className="shrink-0 rounded-full border border-mesh-green/30 bg-mesh-green/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-mesh-green">
                You
              </span>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-mesh-text-secondary">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClass)} />
            <span className="truncate">{statusLabel}</span>
            {lastSeen && (
              <span className="truncate text-mesh-text-muted">
                last seen {lastSeen}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ProfileStat label="Status" value={statusLabel} />
          <ProfileStat label="Mutual" value={`${mutualServers.length}`} />
          <ProfileStat label="Roles" value={serverId ? roleSummary : 'N/A'} />
        </div>

        <section className="rounded-xl border border-mesh-border/70 bg-mesh-bg-tertiary/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted">
              User ID
            </span>
            {copied && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-mesh-green">
                Copied
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary/80 px-2.5 py-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={accentStyle} />
            <code className="min-w-0 flex-1 truncate text-[11px] font-mono text-mesh-text-secondary">{userId}</code>
            <button
              onClick={copyUserId}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-mesh-text-muted transition-colors hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
              title="Copy User ID"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </section>

        {serverId && contextMember && (
          <section className="rounded-xl border border-mesh-border/70 bg-mesh-bg-tertiary/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="mb-2 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-mesh-text-muted" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted">
                Roles
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {contextRoles.length === 0 ? (
                <span className="rounded-full border border-mesh-border/60 bg-mesh-bg-secondary/70 px-2.5 py-1 text-[11px] text-mesh-text-muted">
                  No roles
                </span>
              ) : (
                contextRoles.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-mesh-border/70 bg-mesh-bg-secondary/80 px-2.5 py-1 text-[11px] text-mesh-text-secondary shadow-sm"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="truncate">{r.name}</span>
                  </span>
                ))
              )}
            </div>
          </section>
        )}

        {!isSelf && mutualServers.length > 0 && (
          <section className="rounded-xl border border-mesh-border/70 bg-mesh-bg-tertiary/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="mb-2 flex items-center gap-2">
              <Server className="h-3.5 w-3.5 text-mesh-text-muted" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted">
                Mutual servers - {mutualServers.length}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {mutualServers.slice(0, 4).map((sv) => (
                <button
                  key={sv.id}
                  onClick={() => { navigate(`/channels/${sv.id}`); onAction?.() }}
                  className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-mesh-bg-secondary/80"
                >
                  <ServerAvatar
                    name={sv.name}
                    className="h-7 w-7 rounded-lg text-[10px] shadow-sm transition-transform group-hover:scale-105"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-mesh-text-secondary group-hover:text-mesh-text-primary">
                    {sv.name}
                  </span>
                </button>
              ))}
              {mutualServers.length > 4 && (
                <span className="px-2 pt-1 text-[11px] text-mesh-text-muted">
                  +{mutualServers.length - 4} more
                </span>
              )}
            </div>
          </section>
        )}

        {!isSelf && (
          <button
            onClick={async () => {
              await ensureConversation(userId)
              navigate(`/channels/@me/dm_${userId}`)
              onAction?.()
            }}
            className="mt-0.5 flex h-10 items-center justify-center gap-2 rounded-lg bg-mesh-green text-sm font-semibold text-white shadow-[0_12px_28px_rgba(35,165,89,0.28)] transition hover:bg-mesh-green-light hover:shadow-[0_14px_34px_rgba(35,165,89,0.36)]"
          >
            <MessageSquare className="h-4 w-4" />
            Message
          </button>
        )}
      </div>
    </div>
  )
}

function ProfileStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-mesh-border/60 bg-mesh-bg-tertiary/55 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <span className="block truncate text-[9px] font-semibold uppercase tracking-wide text-mesh-text-muted">
        {label}
      </span>
      <span className="mt-0.5 block truncate text-xs font-semibold text-mesh-text-primary">
        {value}
      </span>
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
