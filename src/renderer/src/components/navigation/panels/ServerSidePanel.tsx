import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { resolveRoleNames, DEFAULT_ROLE_NAMES } from '@/lib/roleNames'
import { useServersStore } from '@/stores/servers.store'
import type { ServerMember } from '@/types/server'
import { useIdentityStore } from '@/stores/identity.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'
import { ChannelTree } from '@/components/server/ChannelTree'

interface ServerSidePanelProps {
  serverId: string
}

// Stable empty reference so selectors that fall back to [] don't produce a
// fresh array on every render — Zustand would treat it as a new snapshot and
// trigger an endless re-render loop / "getSnapshot should be cached" warning.
const EMPTY_MEMBERS: ServerMember[] = []

function ServerSidePanel({ serverId }: ServerSidePanelProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const servers = useServersStore((s) => s.servers)
  const leaveServer = useServersStore((s) => s.leaveServer)
  const members = useServersStore((s) => s.serverMembers[serverId]) || EMPTY_MEMBERS
  const onlineIds = useServersStore((s) => s.serverOnlineMembers[serverId])
  const identity = useIdentityStore((s) => s.identity)
  const serverAvatars = useServerAvatarStore((s) => s.byServer)
  const uploadServerAvatar = useServerAvatarStore((s) => s.uploadForServer)
  const clearServerAvatar = useServerAvatarStore((s) => s.clearForServer)

  const [showDropdown, setShowDropdown] = useState(false)
  const [copiedLocal, setCopiedLocal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showRoleNamesModal, setShowRoleNamesModal] = useState(false)
  const [showRoleManager, setShowRoleManager] = useState(false)
  const setRoleNames = useServersStore((s) => s.setRoleNames)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Parse active channel id out of the URL (route pattern: /channels/:id[/:channelId]).
  const activeChannelId = location.pathname.match(/^\/channels\/[^/]+\/(.+)$/)?.[1] ?? null

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const server = servers.find((s) => s.id === serverId)
  const serverAvatar = serverAvatars[serverId]
  const canManageServer = server?.role === 'host' || server?.role === 'moderator'

  if (!server) {
    return (
      <div className="p-4">
        <span className="text-sm text-mesh-text-muted">Server not found</span>
      </div>
    )
  }

  // Count from LIVE presence (self always counts) — the roster's persisted
  // status field claims 'online' forever and produced counts like "2 Online"
  // with nobody actually connected.
  const selfUserId = identity?.userId
  const onlineCount = new Set([
    ...(selfUserId ? [selfUserId] : []),
    ...(onlineIds ?? [])
  ].filter((id) => members.some((m) => m.userId === id))).size

  return (
    <div className="flex flex-col h-full">
      {/* Server Header — slightly taller for breathing room, icon gets a subtle ring and
          hover-bg lifts to tertiary. Chevron rotates on open. */}
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className={cn(
            'w-full flex items-center gap-2.5 h-[50px] px-3.5 border-b border-mesh-border/40 transition-colors',
            showDropdown ? 'bg-mesh-bg-tertiary/60' : 'hover:bg-mesh-bg-tertiary/40'
          )}
        >
          <div
            className="h-7 w-7 rounded-md overflow-hidden flex items-center justify-center text-xs font-bold text-white shrink-0 ring-1 ring-black/20 shadow-sm"
            style={serverAvatar ? undefined : { backgroundColor: server.iconColor }}
          >
            {serverAvatar ? (
              <img src={serverAvatar} alt={server.name} className="h-full w-full object-cover" draggable={false} />
            ) : (
              server.name[0].toUpperCase()
            )}
          </div>
          <span className="text-[13px] font-bold text-mesh-text-primary truncate flex-1 text-left tracking-tight">
            {server.name}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-mesh-text-muted shrink-0 transition-transform duration-200',
              showDropdown && 'rotate-180 text-mesh-text-secondary'
            )}
          />
        </button>

        {showDropdown && (
          <div className="absolute top-full left-2 right-2 mt-1 bg-mesh-bg-elevated border border-mesh-border/50 rounded-lg shadow-xl py-1 z-50 animate-in fade-in-0 zoom-in-95 duration-100">
            <button
              onClick={() => {
                navigator.clipboard.writeText(server.id)
                setCopiedLocal(true)
                setTimeout(() => setCopiedLocal(false), 2000)
              }}
              className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-mesh-text-primary hover:bg-mesh-green hover:text-white rounded-sm transition-colors"
              style={{ width: 'calc(100% - 8px)' }}
            >
              {copiedLocal ? 'Copied!' : 'Copy Server ID'}
            </button>
            {canManageServer && (
              <>
                <div className="h-px bg-mesh-border/50 my-1 mx-2" />
                <button
                  onClick={async () => {
                    setShowDropdown(false)
                    await uploadServerAvatar(serverId)
                  }}
                  className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-mesh-text-primary hover:bg-mesh-green hover:text-white rounded-sm transition-colors"
                  style={{ width: 'calc(100% - 8px)' }}
                >
                  {serverAvatar ? 'Change Server Icon' : 'Upload Server Icon'}
                </button>
                {serverAvatar && (
                  <button
                    onClick={() => {
                      setShowDropdown(false)
                      clearServerAvatar(serverId)
                    }}
                    className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-mesh-text-primary hover:bg-mesh-bg-tertiary rounded-sm transition-colors"
                    style={{ width: 'calc(100% - 8px)' }}
                  >
                    Remove Icon
                  </button>
                )}
              </>
            )}
            {server.role === 'host' && (
              <>
                <button
                  onClick={() => {
                    setShowDropdown(false)
                    setShowRoleManager(true)
                  }}
                  className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-mesh-text-primary hover:bg-mesh-green hover:text-white rounded-sm transition-colors"
                  style={{ width: 'calc(100% - 8px)' }}
                >
                  Manage Roles
                </button>
                <button
                  onClick={() => {
                    setShowDropdown(false)
                    setShowRoleNamesModal(true)
                  }}
                  className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-mesh-text-primary hover:bg-mesh-green hover:text-white rounded-sm transition-colors"
                  style={{ width: 'calc(100% - 8px)' }}
                >
                  Edit Tier Names
                </button>
              </>
            )}
            <div className="h-px bg-mesh-border/50 my-1 mx-2" />
            <button
              onClick={() => {
                setShowConfirmModal(true)
                setShowDropdown(false)
              }}
              className="w-full flex items-center px-2.5 py-1.5 mx-1 text-sm text-red-400 hover:bg-red-500 hover:text-white rounded-sm transition-colors"
              style={{ width: 'calc(100% - 8px)' }}
            >
              {server.role === 'host' ? 'Delete Server' : 'Leave Server'}
            </button>
          </div>
        )}
      </div>

      {/* Channels + Categories (dynamic). Context menu + hover-+ manage actions
          live inside ChannelTree, gated by canManageServer. */}
      <ChannelTree
        serverId={serverId}
        canManage={canManageServer}
        selfRole={(server.role as 'host' | 'moderator' | 'member') ?? 'member'}
        activeChannelId={activeChannelId}
        onSelectTextChannel={(channelId) => navigate(`/channels/${serverId}/${channelId}`)}
      />

      {/* Member Count — subtle top border to separate from channel tree,
          pulsing presence dot, and mono-width numbers so the count doesn't
          jitter as members come and go. */}
      <div className="px-4 py-2.5 bg-mesh-bg-primary shrink-0 border-t border-mesh-border/40">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2 w-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-mesh-green/60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-mesh-green" />
          </span>
          <span className="text-[11px] font-medium text-mesh-text-muted tabular-nums tracking-wide">
            <span className="text-mesh-text-secondary">{onlineCount}</span> Online
            <span className="mx-1.5 text-mesh-text-muted/60">·</span>
            <span className="text-mesh-text-secondary">{members.length}</span> Total
          </span>
        </div>
      </div>

      {/* Role Manager — create/edit/delete custom roles (Discord-style). */}
      {showRoleManager && (
        <RoleManagerModal serverId={server.id} onClose={() => setShowRoleManager(false)} />
      )}

      {/* Role Names Modal — display names only; the permission ladder
          (host > moderator > member) is fixed underneath. */}
      {showRoleNamesModal && (
        <RoleNamesModal
          initial={resolveRoleNames(server.roleNames)}
          onClose={() => setShowRoleNamesModal(false)}
          onSave={async (names) => {
            const isDefault =
              names.host === DEFAULT_ROLE_NAMES.host &&
              names.moderator === DEFAULT_ROLE_NAMES.moderator &&
              names.member === DEFAULT_ROLE_NAMES.member
            await setRoleNames(server.id, isDefault ? null : names)
            setShowRoleNamesModal(false)
          }}
        />
      )}

      {/* Confirm Modal */}
      <Modal isOpen={showConfirmModal} onClose={() => setShowConfirmModal(false)} title={server.role === 'host' ? 'Delete Server' : 'Leave Server'}>
        <div className="p-1">
          <p className="text-sm text-mesh-text-secondary mb-6">
            {server.role === 'host' 
              ? `Delete "${server.name}"? This removes the server for everyone. This cannot be undone.`
              : `Leave "${server.name}"? You'll lose access to all channels in this server.`}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>
              Cancel
            </Button>
            <Button 
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => {
                if (leaveServer) leaveServer(server.id, server.role === 'host')
                setShowConfirmModal(false)
                navigate('/channels/@me')
              }}
            >
              {server.role === 'host' ? 'Delete Server' : 'Leave Server'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

const ROLE_COLORS = ['#e5484d', '#e0af68', '#2f9e6e', '#7aa2f7', '#b48ead', '#d08770', '#8fbcbb', '#9b9ba3']

function RoleManagerModal({ serverId, onClose }: { serverId: string; onClose: () => void }): JSX.Element {
  const roles = useServersStore((s) => s.serverRoles[serverId]) ?? []
  const createRole = useServersStore((s) => s.createRole)
  const updateRole = useServersStore((s) => s.updateRole)
  const deleteRole = useServersStore((s) => s.deleteRole)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(ROLE_COLORS[3])
  const [canModerate, setCanModerate] = useState(false)
  const [busy, setBusy] = useState(false)

  const startEdit = (roleId: string): void => {
    const r = roles.find((x) => x.id === roleId)
    if (!r) return
    setEditingId(r.id)
    setName(r.name)
    setColor(r.color)
    setCanModerate(r.canModerate)
  }

  const resetForm = (): void => {
    setEditingId(null)
    setName('')
    setColor(ROLE_COLORS[3])
    setCanModerate(false)
  }

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      if (editingId) await updateRole(serverId, editingId, trimmed, color, canModerate)
      else await createRole(serverId, trimmed, color, canModerate)
      resetForm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Manage Roles">
      <div className="flex flex-col gap-4">
        {/* Create / edit form */}
        <div className="rounded-lg border border-mesh-border bg-mesh-bg-tertiary p-3 flex flex-col gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary">
            {editingId ? 'Edit role' : 'New role'}
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Role name (e.g. Teacher, Student, MUTED)"
            maxLength={32}
          />
          <div className="flex items-center gap-1.5">
            {ROLE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn(
                  'h-6 w-6 rounded-full transition-transform',
                  color === c ? 'ring-2 ring-white/70 scale-110' : 'hover:scale-105'
                )}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-mesh-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={canModerate}
              onChange={(e) => setCanModerate(e.target.checked)}
              className="accent-[#2f9e6e]"
            />
            Can moderate (mute, kick, manage channels, assign roles)
          </label>
          <div className="flex justify-end gap-2">
            {editingId && (
              <Button variant="secondary" size="sm" onClick={resetForm}>Cancel edit</Button>
            )}
            <Button size="sm" disabled={busy || !name.trim()} onClick={submit}>
              {busy ? 'Saving…' : editingId ? 'Save role' : 'Create role'}
            </Button>
          </div>
        </div>

        {/* Existing roles */}
        {roles.length === 0 ? (
          <p className="text-xs text-mesh-text-muted text-center py-2">
            No custom roles yet. Create one above, then right-click a member to assign it.
          </p>
        ) : (
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {roles.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2.5 rounded-md border border-mesh-border bg-mesh-bg-secondary px-3 py-2"
              >
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                <span className="text-sm text-mesh-text-primary truncate flex-1">{r.name}</span>
                {r.canModerate && (
                  <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-mesh-info/20 text-mesh-info shrink-0">
                    mod
                  </span>
                )}
                <button
                  onClick={() => startEdit(r.id)}
                  className="text-xs text-mesh-text-muted hover:text-mesh-text-primary transition-colors shrink-0"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteRole(serverId, r.id)}
                  className="text-xs text-mesh-danger/80 hover:text-mesh-danger transition-colors shrink-0"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-mesh-text-muted leading-snug">
          Assign roles by right-clicking a member in the member list. Restrict a
          channel to specific roles by right-clicking the channel.
        </p>
      </div>
    </Modal>
  )
}

function RoleNamesModal({
  initial,
  onClose,
  onSave
}: {
  initial: { host: string; moderator: string; member: string }
  onClose: () => void
  onSave: (names: { host: string; moderator: string; member: string }) => Promise<void>
}): JSX.Element {
  const [host, setHost] = useState(initial.host)
  const [moderator, setModerator] = useState(initial.moderator)
  const [member, setMember] = useState(initial.member)
  const [saving, setSaving] = useState(false)

  const clamp = (v: string): string => v.trim().slice(0, 24)

  return (
    <Modal isOpen onClose={onClose} title="Edit Role Names">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-mesh-text-muted">
          Rename the three tiers to fit your server — CEO / Team Lead / Employee,
          Chief / Officer / Crew, anything. Powers stay the same underneath.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary">
            Top role (server owner)
          </span>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={DEFAULT_ROLE_NAMES.host} maxLength={24} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary">
            Middle role (can moderate)
          </span>
          <Input value={moderator} onChange={(e) => setModerator(e.target.value)} placeholder={DEFAULT_ROLE_NAMES.moderator} maxLength={24} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary">
            Base role (everyone else)
          </span>
          <Input value={member} onChange={(e) => setMember(e.target.value)} placeholder={DEFAULT_ROLE_NAMES.member} maxLength={24} />
        </label>
        <div className="flex justify-between items-center mt-2">
          <button
            onClick={() => {
              setHost(DEFAULT_ROLE_NAMES.host)
              setModerator(DEFAULT_ROLE_NAMES.moderator)
              setMember(DEFAULT_ROLE_NAMES.member)
            }}
            className="text-xs text-mesh-text-muted hover:text-mesh-text-primary transition-colors"
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              disabled={saving || !clamp(host) || !clamp(moderator) || !clamp(member)}
              onClick={async () => {
                setSaving(true)
                try {
                  await onSave({ host: clamp(host), moderator: clamp(moderator), member: clamp(member) })
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export { ServerSidePanel }
