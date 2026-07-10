import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AtSign, Ban, ChevronRight, Search, Check, Copy, MessageSquare, MicOff, Phone, Shield, UserMinus, UserRound, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { useIdentityStore } from '@/stores/identity.store'
import { useServersStore } from '@/stores/servers.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { useCallStore } from '@/stores/call.store'
import { useMessagesStore } from '@/stores/messages.store'
import { useAudioPrefsStore } from '@/stores/audioPrefs.store'
import { useLiveStatus } from '@/lib/useLiveStatus'
import { resolveRoleNames } from '@/lib/roleNames'
import { UserProfileCard } from '@/components/profile/UserProfileCard'
import { PERM, MODERATOR_BUNDLE, effectivePermissions, hasPerm } from '../../../../shared/permissions'
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
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const muteMember = useServersStore((s) => s.muteMember)
  const kickMember = useServersStore((s) => s.kickMember)
  const banMember = useServersStore((s) => s.banMember)
  const setMemberRole = useServersStore((s) => s.setMemberRole)
  const ensureConversation = useMessagesStore((s) => s.ensureConversationForFriend)
  const startOutgoingCall = useCallStore((s) => s.startOutgoing)

  const [menu, setMenu] = useState<MenuState | null>(null)
  // "Roles ▸" submenu flyout — scales to any number of roles via search +
  // a capped scrollable list instead of dumping every role into the menu.
  const [rolesFlyout, setRolesFlyout] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')
  const menuRef = useRef<HTMLDivElement | null>(null)
  // Left-click profile popout (Discord-style card next to the member list).
  const [profilePop, setProfilePop] = useState<{ userId: string; username: string; y: number } | null>(null)
  const profileRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!profilePop) return
    const close = (e: MouseEvent): void => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfilePop(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [profilePop])
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
  // Effective permission mask — tier bundle + custom role grants.
  const myPerms = selfMember
    ? effectivePermissions(selfMember.role, selfMember.roleIds, customRoles)
    : 0
  const canMute = hasPerm(myPerms, PERM.muteMembers)
  const canKick = hasPerm(myPerms, PERM.kickMembers)
  const canBan = hasPerm(myPerms, PERM.banMembers)
  const canManageRoles = hasPerm(myPerms, PERM.manageRoles)
  const isHost = selfRole === 'host'
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)
  const userVolumes = useAudioPrefsStore((s) => s.userVolumes)
  const setUserVolume = useAudioPrefsStore((s) => s.setUserVolume)
  const menuTargetVolume = menu ? (userVolumes[menu.target.userId] ?? 100) : 100
  const canModerateTarget = !!menu && menu.target.role !== 'host' && menu.target.userId !== selfId

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    if (menu) document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  // Reset the flyout whenever the menu opens on a different target / closes.
  useEffect(() => {
    setRolesFlyout(false)
    setRoleSearch('')
  }, [menu])

  const grouped = roleOrder
    .map((role) => ({ role, members: members.filter((m) => m.role === role) }))
    .filter((g) => g.members.length > 0)

  function openMenu(e: React.MouseEvent, target: ServerMember): void {
    e.preventDefault()
    e.stopPropagation()
    // The menu opens for any target so roles can be assigned to anyone —
    // but moderation actions (mute/kick/ban) are hidden for self and host.
    setMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 260)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 420)),
      target
    })
  }

  function insertMention(target: ServerMember): void {
    window.dispatchEvent(new CustomEvent('mesh:insert-mention', { detail: { text: `@${target.username}` } }))
    setMenu(null)
  }

  async function openDm(target: ServerMember): Promise<void> {
    await ensureConversation(target.userId)
    navigate(`/channels/@me/dm_${target.userId}`)
    setMenu(null)
  }

  function openProfileFromMenu(target: ServerMember): void {
    setProfilePop({
      userId: target.userId,
      username: target.username,
      y: Math.min((menu?.y ?? 120) - 72, window.innerHeight - 540)
    })
    setMenu(null)
  }

  function startVoiceCall(target: ServerMember): void {
    startOutgoingCall(target.userId, target.username, 'voice')
    setMenu(null)
  }

  function copyUserId(target: ServerMember): void {
    navigator.clipboard.writeText(target.userId).catch(() => {})
    setMenu(null)
  }

  return (
    <div className="relative w-56 h-full border-l border-mesh-border/50 bg-mesh-bg-secondary overflow-y-auto py-3">
      {/* Profile popout — opens to the left of the member list. */}
      {profilePop && (
        <div
          ref={profileRef}
          className="fixed z-[105] w-80 max-h-[520px] overflow-hidden rounded-2xl border border-mesh-border/70 bg-mesh-bg-secondary shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          style={{ right: 236, top: Math.max(52, profilePop.y) }}
        >
          <UserProfileCard
            userId={profilePop.userId}
            username={profilePop.username}
            serverId={serverId}
            className="max-h-[520px]"
            onAction={() => setProfilePop(null)}
          />
        </div>
      )}
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
              onClick={(e) => {
                setMenu(null)
                setProfilePop({
                  userId: member.userId,
                  username: member.username,
                  y: Math.min(e.clientY - 72, window.innerHeight - 540)
                })
              }}
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
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-[100] w-60 rounded-xl border border-mesh-border/60 bg-mesh-bg-elevated/98 py-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur animate-in fade-in-0 zoom-in-95 duration-100"
        >
          <MemberMenuButton icon={<UserRound className="h-4 w-4" />} onClick={() => openProfileFromMenu(menu.target)}>
            Profile
          </MemberMenuButton>
          <MemberMenuButton icon={<AtSign className="h-4 w-4" />} onClick={() => insertMention(menu.target)}>
            Mention
          </MemberMenuButton>

          {menu.target.userId !== selfId && (
            <>
              <MemberMenuButton icon={<MessageSquare className="h-4 w-4" />} onClick={() => { openDm(menu.target).catch(() => {}) }}>
                Message
              </MemberMenuButton>
              <MemberMenuButton icon={<Phone className="h-4 w-4" />} onClick={() => startVoiceCall(menu.target)}>
                Start Voice Call
              </MemberMenuButton>
            </>
          )}

          <MemberMenuSeparator />
          <div className="mx-2 rounded-lg px-2 py-2">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-mesh-text-secondary">
              <Volume2 className="h-3.5 w-3.5 text-mesh-text-muted" />
              <span className="flex-1">User Volume</span>
              <span className="font-mono text-[10px] text-mesh-text-muted">{menuTargetVolume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={menuTargetVolume}
              onChange={(e) => setUserVolume(menu.target.userId, Number(e.currentTarget.value))}
              className="w-full accent-mesh-green"
            />
          </div>

          {canMute && canModerateTarget && (
            <MemberMenuButton
              icon={<MicOff className="h-4 w-4" />}
              onClick={() => { muteMember(serverId, menu.target.userId, !menu.target.isMuted); setMenu(null) }}
            >
              {menu.target.isMuted ? 'Unmute' : 'Mute'}
            </MemberMenuButton>
          )}

          {isHost && menu.target.role !== 'host' && (
            <>
              <MemberMenuSeparator />
              {menu.target.role === 'member' ? (
                <MemberMenuButton
                  icon={<Shield className="h-4 w-4" />}
                  onClick={() => { setMemberRole(serverId, menu.target.userId, 'moderator'); setMenu(null) }}
                >
                  Promote to {roleLabels.moderator}
                </MemberMenuButton>
              ) : (
                <MemberMenuButton
                  icon={<Shield className="h-4 w-4" />}
                  onClick={() => { setMemberRole(serverId, menu.target.userId, 'member'); setMenu(null) }}
                >
                  Demote to {roleLabels.member}
                </MemberMenuButton>
              )}
            </>
          )}

          {/* Custom role assignment — "Roles ▸" submenu with search, so a
              server with hundreds of roles still gets a compact menu. */}
          {canManageRoles && customRoles.length > 0 && (
            <>
              <MemberMenuSeparator />
              <div className="relative">
                <MemberMenuButton
                  onClick={() => setRolesFlyout((v) => !v)}
                  active={rolesFlyout}
                  icon={<Shield className="h-4 w-4" />}
                  trailing={<ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                >
                  Roles
                </MemberMenuButton>

                {rolesFlyout && (
                  <div className="absolute right-full -top-1 mr-1 w-56 rounded-lg bg-mesh-bg-elevated border border-mesh-border/60 shadow-2xl py-1.5 z-[110]">
                    <div className="relative mx-2 mb-1.5">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-mesh-text-muted" />
                      <input
                        autoFocus
                        value={roleSearch}
                        onChange={(e) => setRoleSearch(e.target.value)}
                        placeholder="Search roles"
                        className="w-full h-7 pl-6.5 pr-2 rounded bg-mesh-bg-secondary border border-mesh-border text-xs text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:border-mesh-green"
                        style={{ paddingLeft: '1.6rem' }}
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {customRoles
                        .filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase()))
                        .map((role) => {
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
                              className="flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] text-left transition-colors text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
                            >
                              <span
                                className={cn(
                                  'h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                                  has ? 'border-transparent' : 'border-mesh-border-light'
                                )}
                                style={has ? { backgroundColor: role.color } : undefined}
                              >
                                {has && <Check className="h-2.5 w-2.5 text-white" />}
                              </span>
                              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                              <span className="truncate flex-1">{role.name}</span>
                              {(role.permissions & MODERATOR_BUNDLE) !== 0 && (
                                <span className="text-[8px] font-bold uppercase text-mesh-text-muted shrink-0">mod</span>
                              )}
                            </button>
                          )
                        })}
                      {customRoles.filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-[11px] text-mesh-text-muted">No roles match.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {(canKick || canBan) && canModerateTarget && (
            <>
              <MemberMenuSeparator />
              {canKick && (
                <MemberMenuButton
                  danger
                  icon={<UserMinus className="h-4 w-4" />}
                  onClick={() => { kickMember(serverId, menu.target.userId); setMenu(null) }}
                >
                  Kick
                </MemberMenuButton>
              )}
              {canBan && (
                <MemberMenuButton
                  danger
                  icon={<Ban className="h-4 w-4" />}
                  onClick={() => { banMember(serverId, menu.target.userId); setMenu(null) }}
                >
                  Ban
                </MemberMenuButton>
              )}
            </>
          )}

          <MemberMenuSeparator />
          <MemberMenuButton icon={<Copy className="h-4 w-4" />} onClick={() => copyUserId(menu.target)}>
            Copy User ID
          </MemberMenuButton>
        </div>
      )}
    </div>
  )
}

function MemberMenuButton({
  children,
  icon,
  trailing,
  danger,
  active,
  onClick
}: {
  children: ReactNode
  icon?: ReactNode
  trailing?: ReactNode
  danger?: boolean
  active?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500 hover:text-white'
          : active
            ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
            : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary'
      )}
    >
      {icon && <span className="grid h-4 w-4 shrink-0 place-items-center">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  )
}

function MemberMenuSeparator(): JSX.Element {
  return <div className="my-1 mx-2 h-px bg-mesh-border/50" />
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
  onClick,
  roleBadgeColor,
  roleBadgeLabel,
  customRoles,
}: {
  member: ServerMember
  isLiveOnline: boolean
  avatarSrc: string | undefined
  onContextMenu: (e: React.MouseEvent) => void
  onClick: (e: React.MouseEvent) => void
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
      onClick={onClick}
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
