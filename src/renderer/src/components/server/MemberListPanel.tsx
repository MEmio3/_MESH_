import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { useIdentityStore } from '@/stores/identity.store'
import { useServersStore } from '@/stores/servers.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { useLiveStatus } from '@/lib/useLiveStatus'
import { resolveRoleNames } from '@/lib/roleNames'
import type { ServerMember, ServerRole } from '@/types/server'

interface MemberListPanelProps {
  serverId: string
  members: ServerMember[]
}

const roleOrder: ServerRole[] = ['host', 'moderator', 'member']
const roleBadgeColors: Record<ServerRole, string> = {
  host: 'bg-mesh-green text-white',
  moderator: 'bg-mesh-info text-white',
  member: '',
}

interface MenuState {
  x: number
  y: number
  target: ServerMember
}

function MemberListPanel({ serverId, members }: MemberListPanelProps): JSX.Element {
  const identity = useIdentityStore((s) => s.identity)
  const muteMember = useServersStore((s) => s.muteMember)
  const kickMember = useServersStore((s) => s.kickMember)
  const banMember = useServersStore((s) => s.banMember)
  const setMemberRole = useServersStore((s) => s.setMemberRole)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // Live presence — who actually has a socket right now. The roster rows'
  // persisted status said 'online' forever (written once at join).
  const onlineIds = useServersStore((s) => s.serverOnlineMembers[serverId])
  // Custom role display names ("CEO / Team Lead / Employee"), defaults merged.
  const server = useServersStore((s) => s.servers.find((sv) => sv.id === serverId))
  const roleLabels = resolveRoleNames(server?.roleNames)
  // Custom roles (Discord-style) + assignment action.
  const customRoles = useServersStore((s) => s.serverRoles[serverId]) ?? []
  const assignMemberRoles = useServersStore((s) => s.assignMemberRoles)

  const selfId = identity?.userId
  const selfMember = members.find((m) => m.userId === selfId)
  const selfRole: ServerRole | null = selfMember?.role ?? null
  // Moderation power: tier ladder OR any assigned custom role with the flag.
  const canModerate =
    selfRole === 'host' ||
    selfRole === 'moderator' ||
    customRoles.some((r) => r.canModerate && (selfMember?.roleIds ?? []).includes(r.id))
  const isHost = selfRole === 'host'
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    if (menu) document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const grouped = roleOrder
    .map((role) => ({ role, members: members.filter((m) => m.role === role) }))
    .filter((g) => g.members.length > 0)

  function openMenu(e: React.MouseEvent, target: ServerMember): void {
    e.preventDefault()
    if (!canModerate) return
    // The menu opens for any target so roles can be assigned to anyone —
    // but moderation actions (mute/kick/ban) are hidden for self and host.
    setMenu({ x: e.clientX, y: e.clientY, target })
  }

  return (
    <div className="w-56 h-full border-l border-mesh-border/50 bg-mesh-bg-secondary overflow-y-auto py-3">
      {grouped.map((group) => (
        <div key={group.role} className="mb-4">
          <div className="px-4 pb-1.5">
            <span className="text-[11px] font-semibold text-mesh-text-muted uppercase tracking-wide">
              {roleLabels[group.role]} — {group.members.length}
            </span>
          </div>
          {group.members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              isLiveOnline={member.userId === selfId || (onlineIds?.includes(member.userId) ?? false)}
              avatarSrc={(member.userId === selfId ? selfAvatar : avatarsByUser[member.userId]) ?? undefined}
              onContextMenu={(e) => openMenu(e, member)}
              roleBadgeColor={roleBadgeColors[member.role]}
              roleBadgeLabel={member.role === 'host' ? roleLabels.host : roleLabels.moderator}
              customRoles={customRoles.filter((r) => member.roleIds.includes(r.id))}
            />
          ))}
        </div>
      ))}

      {menu && (
        <div
          ref={menuRef}
          style={{ top: menu.y, left: menu.x }}
          className="fixed z-[100] min-w-[180px] bg-mesh-bg-elevated border border-mesh-border/50 rounded-lg shadow-xl py-1.5 animate-in fade-in-0 zoom-in-95 duration-100 flex flex-col"
        >
          {menu.target.role !== 'host' && menu.target.userId !== selfId && (
            <>
              <button
                onClick={() => { muteMember(serverId, menu.target.userId, !menu.target.isMuted); setMenu(null) }}
                className="flex items-center gap-2.5 w-[calc(100%-8px)] px-2.5 py-1.5 text-sm rounded-sm mx-1 text-left transition-colors text-mesh-text-secondary hover:bg-mesh-green hover:text-white"
              >
                {menu.target.isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={() => { kickMember(serverId, menu.target.userId); setMenu(null) }}
                className="flex items-center gap-2.5 w-[calc(100%-8px)] px-2.5 py-1.5 text-sm rounded-sm mx-1 text-left transition-colors text-red-400 hover:bg-red-500 hover:text-white"
              >
                Kick
              </button>
            </>
          )}
          {isHost && menu.target.role !== 'host' && (
            <>
              <div className="h-px bg-mesh-border/50 my-1 mx-2" />
              <button
                onClick={() => { banMember(serverId, menu.target.userId); setMenu(null) }}
                className="flex items-center gap-2.5 w-[calc(100%-8px)] px-2.5 py-1.5 text-sm rounded-sm mx-1 text-left transition-colors text-red-400 hover:bg-red-500 hover:text-white"
              >
                Ban
              </button>
              {menu.target.role === 'member' ? (
                <button
                  onClick={() => { setMemberRole(serverId, menu.target.userId, 'moderator'); setMenu(null) }}
                  className="flex items-center gap-2.5 w-[calc(100%-8px)] px-2.5 py-1.5 text-sm rounded-sm mx-1 text-left transition-colors text-mesh-text-secondary hover:bg-mesh-green hover:text-white"
                >
                  Promote to {roleLabels.moderator}
                </button>
              ) : (
                <button
                  onClick={() => { setMemberRole(serverId, menu.target.userId, 'member'); setMenu(null) }}
                  className="flex items-center gap-2.5 w-[calc(100%-8px)] px-2.5 py-1.5 text-sm rounded-sm mx-1 text-left transition-colors text-mesh-text-secondary hover:bg-mesh-green hover:text-white"
                >
                  Demote to {roleLabels.member}
                </button>
              )}
            </>
          )}

          {/* Custom role assignment — Discord-style checklist. */}
          {customRoles.length > 0 && (
            <>
              <div className="h-px bg-mesh-border/50 my-1 mx-2" />
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted">
                Roles
              </div>
              {customRoles.map((role) => {
                const target = members.find((m) => m.userId === menu.target.userId) ?? menu.target
                const has = target.roleIds.includes(role.id)
                return (
                  <button
                    key={role.id}
                    onClick={() => {
                      const next = has
                        ? target.roleIds.filter((id) => id !== role.id)
                        : [...target.roleIds, role.id]
                      assignMemberRoles(serverId, target.userId, next)
                    }}
                    className="flex items-center gap-2.5 w-[calc(100%-8px)] px-2.5 py-1.5 text-sm rounded-sm mx-1 text-left transition-colors text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
                  >
                    <span
                      className={cn(
                        'h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                        has ? 'border-transparent' : 'border-mesh-border-light'
                      )}
                      style={has ? { backgroundColor: role.color } : undefined}
                    >
                      {has && <span className="text-[9px] leading-none text-white">✓</span>}
                    </span>
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                    <span className="truncate flex-1">{role.name}</span>
                    {role.canModerate && (
                      <span className="text-[8px] font-bold uppercase text-mesh-text-muted shrink-0">mod</span>
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Split out so each row can call `useLiveStatus` — hooks can't run inside a
 * `.map` callback but they can run in a child component. The live presence
 * keeps the dot in sync with `useStatusStore` the moment `status:changed`
 * fires, without each server needing its own subscription.
 */
function MemberRow({
  member,
  isLiveOnline,
  avatarSrc,
  onContextMenu,
  roleBadgeColor,
  roleBadgeLabel,
  customRoles,
}: {
  member: ServerMember
  isLiveOnline: boolean
  avatarSrc: string | undefined
  onContextMenu: (e: React.MouseEvent) => void
  roleBadgeColor: string
  roleBadgeLabel: string
  customRoles: Array<{ id: string; name: string; color: string }>
}): JSX.Element {
  // Fallback comes from the LIVE per-server presence set, never from the
  // roster's persisted status (which is 'online' forever).
  const status = useLiveStatus(member.userId, isLiveOnline ? 'online' : 'offline')
  // Discord-style: the name takes the colour of the member's first role.
  const nameColor = status !== 'offline' && customRoles[0] ? customRoles[0].color : undefined
  return (
    <div
      onContextMenu={onContextMenu}
      className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-mesh-bg-tertiary/50 transition-colors cursor-pointer"
    >
      <Avatar fallback={member.username} size="sm" status={status} src={avatarSrc} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'text-sm truncate',
              status === 'offline' ? 'text-mesh-text-muted' : 'text-mesh-text-primary'
            )}
            style={nameColor ? { color: nameColor } : undefined}
          >
            {member.username}
          </span>
          {customRoles.slice(0, 3).map((r) => (
            <span
              key={r.id}
              title={r.name}
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: r.color }}
            />
          ))}
          {member.role !== 'member' && (
            <span className={cn(
              'text-[9px] font-bold uppercase px-1 py-0.5 rounded max-w-[80px] truncate',
              roleBadgeColor
            )}>
              {roleBadgeLabel}
            </span>
          )}
          {member.isMuted && (
            <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-mesh-bg-tertiary text-mesh-text-muted">
              MUTED
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export { MemberListPanel }
