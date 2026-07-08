import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X, Search, ChevronLeft, Copy, Check, Trash2, Pencil, UserPlus, Router, Wifi } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'
import { Avatar } from '@/components/ui/Avatar'
import { useServersStore } from '@/stores/servers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'
import { useSettingsStore, type ServerHostAssignment } from '@/stores/settings.store'
import { resolveRoleNames, DEFAULT_ROLE_NAMES } from '@/lib/roleNames'
import { PERM, PERMISSION_GROUPS, effectivePermissions, hasPerm } from '../../../../shared/permissions'
import type { ServerMember, ServerRoleDef } from '@/types/server'

const ROLE_COLORS = ['#e5484d', '#e0af68', '#2f9e6e', '#7aa2f7', '#b48ead', '#d08770', '#8fbcbb', '#9b9ba3']

type Section = 'overview' | 'roles' | 'members'

function normalizePort(value: string | number | null | undefined): number {
  const raw = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(raw)) return 3000
  return Math.min(65535, Math.max(1, Math.floor(raw)))
}

/**
 * Full-screen server settings, Discord-style: sidebar navigation on the left,
 * content on the right, ESC (or the X) returns to the server. Every control
 * is wired to the real store actions — nothing here is decorative.
 */
function ServerSettingsPage(): JSX.Element | null {
  const { serverId = '' } = useParams()
  const navigate = useNavigate()

  const server = useServersStore((s) => s.servers.find((sv) => sv.id === serverId))
  const members = useServersStore((s) => s.serverMembers[serverId]) ?? []
  const roles = useServersStore((s) => s.serverRoles[serverId]) ?? []
  const leaveServer = useServersStore((s) => s.leaveServer)
  const identity = useIdentityStore((s) => s.identity)

  const [section, setSection] = useState<Section>('overview')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const close = (): void => { navigate(`/channels/${serverId}`) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  // Server left/deleted while the page was open — bounce home.
  useEffect(() => {
    if (!server) navigate('/channels/@me')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server])
  if (!server) return null

  const selfMember = members.find((m) => m.userId === identity?.userId)
  const myPerms = selfMember
    ? effectivePermissions(selfMember.role, selfMember.roleIds, roles)
    : 0
  const isHost = server.role === 'host'
  const canManageRoles = isHost || hasPerm(myPerms, PERM.manageRoles)
  const canEditServer = isHost || hasPerm(myPerms, PERM.manageServer)

  return (
    <div className="h-screen w-screen bg-mesh-bg-primary flex">
      {/* Sidebar */}
      <div className="w-56 shrink-0 h-full bg-mesh-bg-secondary border-r border-mesh-border flex flex-col py-8 pl-6 pr-2 overflow-y-auto">
        <span className="text-[11px] font-bold uppercase tracking-wide text-mesh-text-muted truncate pr-2 mb-2">
          {server.name}
        </span>
        <SidebarItem label="Overview" active={section === 'overview'} onClick={() => setSection('overview')} />
        <SidebarItem label="Roles" active={section === 'roles'} onClick={() => setSection('roles')} />
        <SidebarItem label="Members" active={section === 'members'} onClick={() => setSection('members')} />
        <div className="h-px bg-mesh-border my-3 mr-4" />
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex items-center gap-2 px-2.5 py-1.5 mr-4 rounded-md text-sm text-left text-mesh-danger hover:bg-mesh-danger/10 transition-colors"
        >
          {isHost ? 'Delete Server' : 'Leave Server'}
          <Trash2 className="h-3.5 w-3.5 ml-auto" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-10 py-10 relative">
          {section === 'overview' && (
            <OverviewSection serverId={serverId} canEditServer={canEditServer} />
          )}
          {section === 'roles' && (
            <RolesSection serverId={serverId} members={members} roles={roles} canManageRoles={canManageRoles} />
          )}
          {section === 'members' && (
            <MembersSection serverId={serverId} members={members} roles={roles} myPerms={myPerms} isHost={isHost} />
          )}
        </div>
      </div>

      {/* ESC affordance */}
      <div className="shrink-0 pt-10 pr-10">
        <button
          onClick={close}
          className="flex flex-col items-center gap-1 text-mesh-text-muted hover:text-mesh-text-primary transition-colors group"
        >
          <span className="h-9 w-9 rounded-full border-2 border-current flex items-center justify-center group-hover:bg-mesh-bg-tertiary transition-colors">
            <X className="h-4 w-4" />
          </span>
          <span className="text-[11px] font-semibold">ESC</span>
        </button>
      </div>

      {/* Delete / Leave confirm */}
      <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} title={isHost ? 'Delete Server' : 'Leave Server'}>
        <p className="text-sm text-mesh-text-secondary mb-5">
          {isHost
            ? `Delete "${server.name}"? This removes the server for everyone and cannot be undone.`
            : `Leave "${server.name}"? You'll lose access to all its channels.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              leaveServer(server.id, isHost)
              navigate('/channels/@me')
            }}
          >
            {isHost ? 'Delete Server' : 'Leave Server'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function SidebarItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1.5 mr-4 mb-0.5 rounded-md text-sm text-left transition-colors',
        active
          ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
          : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60 hover:text-mesh-text-primary'
      )}
    >
      {label}
    </button>
  )
}

/* ───────────────────────────── Overview ───────────────────────────── */

function OverviewSection({ serverId, canEditServer }: { serverId: string; canEditServer: boolean }): JSX.Element {
  const server = useServersStore((s) => s.servers.find((sv) => sv.id === serverId))
  const setRoleNames = useServersStore((s) => s.setRoleNames)
  const serverAvatar = useServerAvatarStore((s) => s.byServer[serverId])
  const uploadServerAvatar = useServerAvatarStore((s) => s.uploadForServer)
  const clearServerAvatar = useServerAvatarStore((s) => s.clearForServer)
  const identity = useIdentityStore((s) => s.identity)
  const network = useSettingsStore((s) => s.network)
  const updateNetwork = useSettingsStore((s) => s.updateNetwork)

  const labels = resolveRoleNames(server?.roleNames)
  const [host, setHost] = useState(labels.host)
  const [moderator, setModerator] = useState(labels.moderator)
  const [member, setMember] = useState(labels.member)
  const [savingNames, setSavingNames] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState(false)
  const [routeSaving, setRouteSaving] = useState(false)
  const [hostStatus, setHostStatus] = useState<{
    running: boolean
    port: number
    ports: number[]
    localIps: Array<{ address: string; scope: 'home' | 'isp' | 'public'; label: string; iface: string }>
    error: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.signalingHost.status()
      .then((status) => {
        if (!cancelled) setHostStatus(status)
      })
      .catch(() => {
        if (!cancelled) setHostStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!server) return <></>

  const namesDirty = host !== labels.host || moderator !== labels.moderator || member !== labels.member
  const clamp = (v: string): string => v.trim().slice(0, 24)
  const hostedPorts = [...new Set([network.hostPort, ...network.extraHostPorts].map(normalizePort))].sort((a, b) => a - b)
  const localIps = hostStatus?.localIps ?? []
  const defaultAddress = localIps.find((ip) => ip.scope === 'home')?.address ?? localIps[0]?.address ?? 'localhost'
  const savedAssignment = network.serverHostAssignments[serverId]
  const assignedPort = hostedPorts.includes(normalizePort(savedAssignment?.port))
    ? normalizePort(savedAssignment?.port)
    : normalizePort(network.hostPort)
  const assignedAddress = savedAssignment?.address || defaultAddress
  const inviteAddress = `http://${assignedAddress}:${assignedPort}`

  const saveHostAssignment = async (partial: Partial<ServerHostAssignment>): Promise<void> => {
    if (server.role !== 'host' || routeSaving) return
    const previous = { port: assignedPort, address: assignedAddress }
    const next: ServerHostAssignment = {
      port: normalizePort(partial.port ?? assignedPort),
      address: String(partial.address ?? assignedAddress).trim() || defaultAddress
    }

    setRouteSaving(true)
    try {
      if (!(hostStatus?.ports ?? []).includes(next.port)) {
        const start = await window.api.signalingHost.start({ port: next.port })
        if (!start.success) return
      }
      if (previous.port !== next.port) {
        window.api.signaling.emit('server:unregister', { serverId, port: previous.port })
      }
      updateNetwork({
        serverHostAssignments: {
          ...network.serverHostAssignments,
          [serverId]: next
        }
      })
      if (identity) {
        await window.api.server.reregisterMine({
          selfUserId: identity.userId,
          selfUsername: identity.username,
          selfAvatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null
        })
      }
      setHostStatus(await window.api.signalingHost.status())
    } finally {
      setRouteSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-xl font-bold text-mesh-text-primary -mb-2">Overview</h2>

      {/* Identity card */}
      <div className="flex items-center gap-4">
        <div
          className="h-20 w-20 rounded-xl overflow-hidden flex items-center justify-center text-2xl font-bold text-white shrink-0 ring-1 ring-mesh-border"
          style={serverAvatar ? undefined : { backgroundColor: server.iconColor }}
        >
          {serverAvatar ? (
            <img src={serverAvatar} alt={server.name} className="h-full w-full object-cover" draggable={false} />
          ) : (
            server.name[0]?.toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-mesh-text-primary truncate">{server.name}</h3>
          <p className="text-xs text-mesh-text-muted">
            {server.memberCount} member{server.memberCount === 1 ? '' : 's'}
          </p>
          {canEditServer && (
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="secondary" onClick={() => uploadServerAvatar(serverId)}>
                {serverAvatar ? 'Change Icon' : 'Upload Icon'}
              </Button>
              {serverAvatar && (
                <Button size="sm" variant="ghost" onClick={() => clearServerAvatar(serverId)}>
                  Remove Icon
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Server ID */}
      <div>
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1.5">
          Server ID — share this so friends can join
        </span>
        <div className="flex items-center gap-2 rounded-lg bg-mesh-bg-secondary border border-mesh-border px-3 py-2.5 max-w-md">
          <code className="flex-1 text-sm text-mesh-green font-mono truncate">{server.id}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(server.id)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors"
            title="Copy Server ID"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {canEditServer && server.role === 'host' && (
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1.5">
            Hosting route
          </span>
          <p className="text-xs text-mesh-text-muted mb-3 max-w-md">
            Choose which local host port and share IP this community uses.
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-mesh-text-muted uppercase">Port</span>
              <select
                value={assignedPort}
                disabled={routeSaving}
                onChange={(e) => saveHostAssignment({ port: normalizePort(e.target.value) })}
                className="h-9 rounded-md border border-mesh-border bg-mesh-bg-secondary px-3 text-sm text-mesh-text-primary outline-none focus:border-mesh-green/60 disabled:opacity-70"
              >
                {hostedPorts.map((port) => (
                  <option key={port} value={port}>
                    {port}{port === normalizePort(network.hostPort) ? ' - primary' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-mesh-text-muted uppercase">Share IP</span>
              <select
                value={assignedAddress}
                disabled={routeSaving}
                onChange={(e) => saveHostAssignment({ address: e.target.value })}
                className="h-9 rounded-md border border-mesh-border bg-mesh-bg-secondary px-3 text-sm text-mesh-text-primary outline-none focus:border-mesh-green/60 disabled:opacity-70"
              >
                <option value="localhost">localhost - this computer</option>
                {localIps.map((ip) => (
                  <option key={`${ip.iface}-${ip.address}`} value={ip.address}>
                    {ip.address} - {ip.scope === 'home' ? 'same Wi-Fi' : ip.scope}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex max-w-md items-center gap-2 rounded-lg border border-mesh-border bg-mesh-bg-secondary px-3 py-2.5">
            <Router className="h-4 w-4 shrink-0 text-mesh-green" />
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-mesh-green">
              {inviteAddress} / {server.id}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${inviteAddress} / ${server.id}`)
                setCopiedInvite(true)
                setTimeout(() => setCopiedInvite(false), 1500)
              }}
              className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors"
              title="Copy invite"
            >
              {copiedInvite ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-mesh-text-muted">
            <Wifi className="h-3.5 w-3.5" />
            <span>{routeSaving ? 'Updating route...' : `Running ports: ${(hostStatus?.ports ?? []).join(', ') || 'none'}`}</span>
          </div>
        </div>
      )}

      {/* Tier names */}
      {canEditServer && (
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1.5">
            Tier names
          </span>
          <p className="text-xs text-mesh-text-muted mb-3 max-w-md">
            Rename the three built-in tiers (owner / moderator / everyone else).
            Powers stay the same underneath; custom roles live in the Roles tab.
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-md">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-mesh-text-muted uppercase">Owner tier</span>
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={DEFAULT_ROLE_NAMES.host} maxLength={24} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-mesh-text-muted uppercase">Mod tier</span>
              <Input value={moderator} onChange={(e) => setModerator(e.target.value)} placeholder={DEFAULT_ROLE_NAMES.moderator} maxLength={24} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-mesh-text-muted uppercase">Base tier</span>
              <Input value={member} onChange={(e) => setMember(e.target.value)} placeholder={DEFAULT_ROLE_NAMES.member} maxLength={24} />
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              disabled={savingNames || !namesDirty || !clamp(host) || !clamp(moderator) || !clamp(member)}
              onClick={async () => {
                setSavingNames(true)
                try {
                  const next = { host: clamp(host), moderator: clamp(moderator), member: clamp(member) }
                  const isDefault =
                    next.host === DEFAULT_ROLE_NAMES.host &&
                    next.moderator === DEFAULT_ROLE_NAMES.moderator &&
                    next.member === DEFAULT_ROLE_NAMES.member
                  await setRoleNames(serverId, isDefault ? null : next)
                } finally {
                  setSavingNames(false)
                }
              }}
            >
              {savingNames ? 'Saving…' : 'Save tier names'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setHost(DEFAULT_ROLE_NAMES.host)
                setModerator(DEFAULT_ROLE_NAMES.moderator)
                setMember(DEFAULT_ROLE_NAMES.member)
              }}
            >
              Reset to defaults
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── Roles ───────────────────────────── */

function RolesSection({
  serverId,
  members,
  roles,
  canManageRoles
}: {
  serverId: string
  members: ServerMember[]
  roles: ServerRoleDef[]
  canManageRoles: boolean
}): JSX.Element {
  const [search, setSearch] = useState('')
  // null = list view; 'new' = creating; otherwise editing that role id.
  const [editing, setEditing] = useState<string | null>(null)

  const filtered = roles.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
  const countFor = (roleId: string): number => members.filter((m) => m.roleIds.includes(roleId)).length

  if (editing !== null) {
    return (
      <RoleEditor
        serverId={serverId}
        roleId={editing === 'new' ? null : editing}
        members={members}
        roles={roles}
        canManageRoles={canManageRoles}
        onBack={() => setEditing(null)}
        onOpenRole={(id) => setEditing(id)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-mesh-text-primary">Roles</h2>
        <p className="text-xs text-mesh-text-muted mt-1">
          Use roles to group members and grant permissions. Members' names take
          the colour of their first role.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-mesh-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles"
            className="w-full h-9 pl-8 pr-3 rounded-md bg-mesh-bg-secondary border border-mesh-border text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:border-mesh-green focus:ring-1 focus:ring-mesh-green/30"
          />
        </div>
        {canManageRoles && (
          <Button size="sm" onClick={() => setEditing('new')}>Create Role</Button>
        )}
      </div>

      <div className="flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-mesh-text-muted">
        <span>Roles — {filtered.length}</span>
        <span>Members</span>
      </div>

      <div className="flex flex-col rounded-lg border border-mesh-border divide-y divide-mesh-border/60">
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-mesh-text-muted">
            {search ? 'No roles match your search.' : 'No roles yet — create one to get started.'}
          </div>
        )}
        {filtered.map((r) => (
          <button
            key={r.id}
            onClick={() => canManageRoles && setEditing(r.id)}
            className={cn(
              'flex items-center gap-3 px-4 py-3 text-left transition-colors',
              canManageRoles && 'hover:bg-mesh-bg-secondary cursor-pointer'
            )}
          >
            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
            <span className="text-sm text-mesh-text-primary truncate flex-1">{r.name}</span>
            <span className="text-xs text-mesh-text-muted tabular-nums w-10 text-right shrink-0">{countFor(r.id)}</span>
            {canManageRoles && <Pencil className="h-3.5 w-3.5 text-mesh-text-muted shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function RoleEditor({
  serverId,
  roleId,
  members,
  roles,
  canManageRoles,
  onBack,
  onOpenRole
}: {
  serverId: string
  roleId: string | null
  members: ServerMember[]
  roles: ServerRoleDef[]
  canManageRoles: boolean
  onBack: () => void
  onOpenRole: (id: string) => void
}): JSX.Element {
  const createRole = useServersStore((s) => s.createRole)
  const updateRole = useServersStore((s) => s.updateRole)
  const deleteRole = useServersStore((s) => s.deleteRole)
  const assignMemberRoles = useServersStore((s) => s.assignMemberRoles)

  const role = roleId ? roles.find((r) => r.id === roleId) ?? null : null
  const [tab, setTab] = useState<'display' | 'permissions' | 'members'>('display')
  const [name, setName] = useState(role?.name ?? '')
  const [color, setColor] = useState(role?.color ?? ROLE_COLORS[3])
  const [permMask, setPermMask] = useState(role?.permissions ?? 0)
  const [busy, setBusy] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')

  // Re-seed the form when switching between roles in the mini list.
  const seededFor = useRef(roleId)
  useEffect(() => {
    if (seededFor.current !== roleId) {
      seededFor.current = roleId
      const r = roleId ? roles.find((x) => x.id === roleId) ?? null : null
      setName(r?.name ?? '')
      setColor(r?.color ?? ROLE_COLORS[3])
      setPermMask(r?.permissions ?? 0)
      setTab('display')
    }
  }, [roleId, roles])

  const dirty = role
    ? name !== role.name || color !== role.color || permMask !== role.permissions
    : name.trim().length > 0

  const holders = members.filter((m) => roleId && m.roleIds.includes(roleId))
  const memberFiltered = members.filter((m) => m.username.toLowerCase().includes(memberSearch.toLowerCase()))

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      if (role) await updateRole(serverId, role.id, trimmed, color, permMask)
      else {
        await createRole(serverId, trimmed, color, permMask)
        onBack() // list view shows the fresh role; click it to keep editing
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-6">
      {/* Mini role list */}
      <div className="w-40 shrink-0 flex flex-col gap-1">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-2 py-1.5 mb-1 rounded-md text-sm text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary/60 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        {roles.map((r) => (
          <button
            key={r.id}
            onClick={() => onOpenRole(r.id)}
            className={cn(
              'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-left transition-colors min-w-0',
              roleId === r.id
                ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
                : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60'
            )}
          >
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
            <span className="truncate">{r.name}</span>
          </button>
        ))}
      </div>

      {/* Editor pane */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <h2 className="text-base font-bold text-mesh-text-primary uppercase tracking-wide">
          {role ? `Edit Role — ${role.name}` : 'New Role'}
        </h2>

        {/* Tabs */}
        <div className="flex items-center gap-5 border-b border-mesh-border text-sm">
          {([
            ['display', 'Display'],
            ['permissions', 'Permissions'],
            ['members', `Manage Members (${holders.length})`]
          ] as Array<['display' | 'permissions' | 'members', string]>).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              disabled={key === 'members' && !role}
              className={cn(
                'pb-2 -mb-px border-b-2 transition-colors disabled:opacity-40',
                tab === key
                  ? 'border-mesh-green text-mesh-text-primary'
                  : 'border-transparent text-mesh-text-secondary hover:text-mesh-text-primary'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'display' && (
          <div className="flex flex-col gap-4 max-w-md">
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1">
                Role name <span className="text-mesh-danger">*</span>
              </span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Teacher" maxLength={32} />
            </div>
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1.5">
                Role color <span className="text-mesh-danger">*</span>
              </span>
              <p className="text-[11px] text-mesh-text-muted mb-2">
                Members use the colour of their first role in the member list.
              </p>
              <div className="flex items-center gap-1.5">
                {ROLE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={cn(
                      'h-7 w-7 rounded-md transition-transform',
                      color === c ? 'ring-2 ring-white/70 scale-110' : 'hover:scale-105'
                    )}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'permissions' && (
          <div className="flex flex-col gap-4">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.group}>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1">
                  {group.group}
                </span>
                <div className="flex flex-col rounded-lg border border-mesh-border divide-y divide-mesh-border/60">
                  {group.items.map((item) => (
                    <div key={item.key} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <span className="block text-[13px] text-mesh-text-primary">{item.label}</span>
                        <span className="block text-[11px] text-mesh-text-muted leading-snug">{item.description}</span>
                      </div>
                      <Toggle
                        checked={(permMask & PERM[item.key]) === PERM[item.key]}
                        onChange={() => setPermMask((m) => (m & PERM[item.key]) === PERM[item.key] ? m & ~PERM[item.key] : m | PERM[item.key])}
                        className="mt-0.5 shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-mesh-text-muted leading-snug">
              Every member can already send messages, attach files, react, and join
              voice by default — role permissions grant powers on top of that.
            </p>
          </div>
        )}

        {tab === 'members' && role && (
          <div className="flex flex-col gap-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-mesh-text-muted" />
              <input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search members"
                className="w-full h-9 pl-8 pr-3 rounded-md bg-mesh-bg-secondary border border-mesh-border text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:border-mesh-green focus:ring-1 focus:ring-mesh-green/30"
              />
            </div>
            <div className="flex flex-col rounded-lg border border-mesh-border divide-y divide-mesh-border/60">
              {memberFiltered.map((m) => {
                const has = m.roleIds.includes(role.id)
                return (
                  <div key={m.userId} className="flex items-center gap-3 px-3.5 py-2.5">
                    <MemberAvatar member={m} />
                    <span className="text-sm text-mesh-text-primary truncate flex-1">{m.username}</span>
                    <Toggle
                      checked={has}
                      onChange={() => {
                        const next = has
                          ? m.roleIds.filter((id) => id !== role.id)
                          : [...m.roleIds, role.id]
                        assignMemberRoles(serverId, m.userId, next)
                      }}
                    />
                  </div>
                )
              })}
              {memberFiltered.length === 0 && (
                <div className="px-4 py-5 text-center text-xs text-mesh-text-muted">No members match.</div>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        {canManageRoles && (
          <div className="flex items-center justify-between pt-2 border-t border-mesh-border mt-2">
            {role ? (
              <button
                onClick={async () => { await deleteRole(serverId, role.id); onBack() }}
                className="text-xs text-mesh-danger/80 hover:text-mesh-danger transition-colors"
              >
                Delete role
              </button>
            ) : <span />}
            <Button size="sm" disabled={busy || !name.trim() || !dirty} onClick={save}>
              {busy ? 'Saving…' : role ? 'Save Changes' : 'Create Role'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────────── Members ───────────────────────────── */

function MembersSection({
  serverId,
  members,
  roles,
  myPerms,
  isHost
}: {
  serverId: string
  members: ServerMember[]
  roles: ServerRoleDef[]
  myPerms: number
  isHost: boolean
}): JSX.Element {
  const kickMember = useServersStore((s) => s.kickMember)
  const banMember = useServersStore((s) => s.banMember)
  const assignMemberRoles = useServersStore((s) => s.assignMemberRoles)
  const server = useServersStore((s) => s.servers.find((sv) => sv.id === serverId))
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const labels = resolveRoleNames(server?.roleNames)

  const [search, setSearch] = useState('')
  const [rolePickerFor, setRolePickerFor] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { setPickerSearch('') }, [rolePickerFor])

  const canManageRoles = isHost || hasPerm(myPerms, PERM.manageRoles)
  const canKick = hasPerm(myPerms, PERM.kickMembers)
  const canBan = hasPerm(myPerms, PERM.banMembers)

  useEffect(() => {
    if (!rolePickerFor) return
    const close = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setRolePickerFor(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [rolePickerFor])

  const filtered = members.filter((m) => m.username.toLowerCase().includes(search.toLowerCase()))
  const tierLabel = (m: ServerMember): string =>
    m.role === 'host' ? labels.host : m.role === 'moderator' ? labels.moderator : labels.member

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-mesh-text-primary">Members</h2>
        <p className="text-xs text-mesh-text-muted mt-1">
          {members.length} member{members.length === 1 ? '' : 's'} — assign roles, kick or ban from here.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-mesh-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username"
          className="w-full h-9 pl-8 pr-3 rounded-md bg-mesh-bg-secondary border border-mesh-border text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:border-mesh-green focus:ring-1 focus:ring-mesh-green/30"
        />
      </div>

      <div className="flex flex-col rounded-lg border border-mesh-border divide-y divide-mesh-border/60">
        {filtered.map((m) => {
          const memberRoles = roles.filter((r) => m.roleIds.includes(r.id))
          const isSelf = m.userId === selfId
          const targetIsHost = m.role === 'host'
          return (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <MemberAvatar member={m} />
              <div className="min-w-0 w-44 shrink-0">
                <span
                  className="block text-sm text-mesh-text-primary truncate"
                  style={memberRoles[0] ? { color: memberRoles[0].color } : undefined}
                >
                  {m.username}{isSelf ? ' (you)' : ''}
                </span>
                <span className="block text-[11px] text-mesh-text-muted truncate">{tierLabel(m)}</span>
              </div>

              {/* Role chips + picker */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap relative">
                {memberRoles.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-mesh-border bg-mesh-bg-secondary px-2 py-0.5 text-[11px] text-mesh-text-secondary max-w-[130px]"
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="truncate">{r.name}</span>
                    {canManageRoles && (
                      <button
                        onClick={() => assignMemberRoles(serverId, m.userId, m.roleIds.filter((id) => id !== r.id))}
                        className="text-mesh-text-muted hover:text-mesh-text-primary shrink-0"
                        title={`Remove ${r.name}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </span>
                ))}
                {canManageRoles && roles.length > 0 && (
                  <button
                    onClick={() => setRolePickerFor(rolePickerFor === m.userId ? null : m.userId)}
                    className="h-5 w-5 rounded-full border border-dashed border-mesh-border-light text-mesh-text-muted hover:text-mesh-green hover:border-mesh-green/50 flex items-center justify-center transition-colors shrink-0"
                    title="Add role"
                  >
                    <UserPlus className="h-3 w-3" />
                  </button>
                )}

                {rolePickerFor === m.userId && (
                  <div
                    ref={pickerRef}
                    className="absolute top-7 left-0 z-50 w-56 rounded-lg bg-mesh-bg-elevated border border-mesh-border shadow-2xl py-1.5"
                  >
                    <div className="relative mx-2 mb-1.5">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-mesh-text-muted" />
                      <input
                        autoFocus
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        placeholder="Search roles"
                        className="w-full h-7 pr-2 rounded bg-mesh-bg-secondary border border-mesh-border text-xs text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:border-mesh-green"
                        style={{ paddingLeft: '1.6rem' }}
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {roles
                        .filter((r) => r.name.toLowerCase().includes(pickerSearch.toLowerCase()))
                        .map((r) => {
                          const has = m.roleIds.includes(r.id)
                          return (
                            <button
                              key={r.id}
                              onClick={() => {
                                const next = has
                                  ? m.roleIds.filter((id) => id !== r.id)
                                  : [...m.roleIds, r.id]
                                assignMemberRoles(serverId, m.userId, next)
                              }}
                              className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-[13px] text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary transition-colors"
                            >
                              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                              <span className="truncate flex-1">{r.name}</span>
                              {has && <Check className="h-3 w-3 text-mesh-green shrink-0" />}
                            </button>
                          )
                        })}
                      {roles.filter((r) => r.name.toLowerCase().includes(pickerSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-[11px] text-mesh-text-muted">No roles match.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Moderation */}
              {!isSelf && !targetIsHost && (canKick || canBan) && (
                <div className="flex items-center gap-1 shrink-0">
                  {canKick && (
                    <button
                      onClick={() => kickMember(serverId, m.userId)}
                      className="text-[11px] px-2 py-1 rounded text-mesh-text-muted hover:text-mesh-danger hover:bg-mesh-danger/10 transition-colors"
                    >
                      Kick
                    </button>
                  )}
                  {canBan && (
                    <button
                      onClick={() => banMember(serverId, m.userId)}
                      className="text-[11px] px-2 py-1 rounded text-mesh-danger/80 hover:text-mesh-danger hover:bg-mesh-danger/10 transition-colors"
                    >
                      Ban
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-mesh-text-muted">No members match.</div>
        )}
      </div>
    </div>
  )
}

function MemberAvatar({ member }: { member: ServerMember }): JSX.Element {
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)
  const src = (member.userId === selfId ? selfAvatar : avatarsByUser[member.userId]) ?? undefined
  return <Avatar fallback={member.username} size="sm" src={src} />
}

export { ServerSettingsPage }
