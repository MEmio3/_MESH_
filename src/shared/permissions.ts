/**
 * Per-role permission bitfield — shared by main process (enforcement) and
 * renderer (UI gating + role editor).
 *
 * Model (Discord-lite, additive):
 *   - The HOST always has every permission; nothing can take that away.
 *   - Members with the legacy 'moderator' tier get MODERATOR_BUNDLE.
 *   - Every member starts from DEFAULT_MEMBER_PERMS (the harmless basics).
 *   - Custom roles GRANT additional bits; a member's effective permissions
 *     are the union of defaults + tier bundle + all assigned roles.
 *
 * There is intentionally no per-permission "deny": muting someone is done
 * with the existing member mute flag, not a negative permission.
 */

export const PERM = {
  // General
  manageServer: 1 << 0,   // rename tiers, server icon, server-level settings
  manageChannels: 1 << 1, // create/rename/delete channels + categories, set visibility
  manageRoles: 1 << 2,    // create/edit/delete roles, assign roles to members
  // Membership
  kickMembers: 1 << 3,
  banMembers: 1 << 4,
  muteMembers: 1 << 5,
  // Text
  sendMessages: 1 << 6,
  attachFiles: 1 << 7,
  addReactions: 1 << 8,
  manageMessages: 1 << 9, // delete other members' messages
  // Voice
  connectVoice: 1 << 10,
  stream: 1 << 11,        // screen share / camera in voice channels
  speak: 1 << 12          // transmit microphone audio in voice channels
} as const

export type PermissionKey = keyof typeof PERM

/** What a plain member can do with no roles at all. */
export const DEFAULT_MEMBER_PERMS =
  PERM.sendMessages | PERM.attachFiles | PERM.addReactions | PERM.connectVoice | PERM.stream | PERM.speak

/** What the legacy 'moderator' tier grants on top of the defaults. */
export const MODERATOR_BUNDLE =
  PERM.manageChannels | PERM.manageRoles | PERM.kickMembers | PERM.muteMembers | PERM.manageMessages

export const ALL_PERMS = Object.values(PERM).reduce((a, b) => a | b, 0)

/**
 * Compute a member's effective permission mask.
 * `roles` is the server's role list; `roleIds` the member's assignments.
 */
export function effectivePermissions(
  tier: 'host' | 'moderator' | 'member' | string,
  roleIds: string[],
  roles: Array<{ id: string; permissions: number }>
): number {
  if (tier === 'host') return ALL_PERMS
  let mask = DEFAULT_MEMBER_PERMS
  if (tier === 'moderator') mask |= MODERATOR_BUNDLE
  for (const r of roles) {
    if (roleIds.includes(r.id)) mask |= r.permissions
  }
  return mask
}

export function hasPerm(mask: number, perm: number): boolean {
  return (mask & perm) === perm
}

/** UI metadata for the role editor — grouped like Discord's permission page. */
export const PERMISSION_GROUPS: Array<{
  group: string
  items: Array<{ key: PermissionKey; label: string; description: string }>
}> = [
  {
    group: 'General',
    items: [
      { key: 'manageServer', label: 'Manage Server', description: 'Change server-level settings like role tier names and the server icon.' },
      { key: 'manageChannels', label: 'Manage Channels', description: 'Create, rename and delete channels and categories, and set who can see them.' },
      { key: 'manageRoles', label: 'Manage Roles', description: 'Create, edit and delete roles, and assign roles to members.' }
    ]
  },
  {
    group: 'Membership',
    items: [
      { key: 'kickMembers', label: 'Kick Members', description: 'Remove members from the server. They can rejoin with the server ID.' },
      { key: 'banMembers', label: 'Ban Members', description: 'Permanently remove members. They cannot rejoin.' },
      { key: 'muteMembers', label: 'Mute Members', description: 'Prevent members from sending messages in the server.' }
    ]
  },
  {
    group: 'Text Channels',
    items: [
      { key: 'sendMessages', label: 'Send Messages', description: 'Send messages in text channels.' },
      { key: 'attachFiles', label: 'Attach Files', description: 'Upload files and images in text channels.' },
      { key: 'addReactions', label: 'Add Reactions', description: 'Add emoji reactions to messages.' },
      { key: 'manageMessages', label: 'Manage Messages', description: 'Delete messages sent by other members.' }
    ]
  },
  {
    group: 'Voice Channels',
    items: [
      { key: 'connectVoice', label: 'Connect', description: 'Join voice channels.' },
      { key: 'speak', label: 'Speak', description: 'Transmit microphone audio in voice channels.' },
      { key: 'stream', label: 'Stream', description: 'Share screen or camera in voice channels.' }
    ]
  }
]

/* ── Per-channel permission overrides (Discord-style) ─────────────────────
   Each channel can override specific permissions per role (or for
   '@everyone') with an explicit allow or deny; unset = inherit from the
   member's server-level roles. Resolution:
     host → always allowed
     base = server-level roles (viewChannel has no bit; base = true)
     @everyone override replaces base, then role overrides — any explicit
     allow among the member's roles wins over denies.
   When a channel has NO overrides, the legacy gates (minRole tier,
   allowedRoleIds, sendRoleIds) still apply so old channels keep working. */

export type ChannelPermKey =
  | 'viewChannel'
  | 'connectVoice'
  | 'speak'
  | 'stream'
  | 'sendMessages'
  | 'attachFiles'
  | 'addReactions'
  | 'manageMessages'

export type OverrideState = 'allow' | 'deny'

/** roleId (or 'everyone') → partial map of channel perms to allow/deny. */
export type ChannelOverrides = Record<string, Partial<Record<ChannelPermKey, OverrideState>>>

export const VOICE_CHANNEL_PERMS: Array<{ key: ChannelPermKey; label: string; description: string }> = [
  { key: 'viewChannel', label: 'View Channel', description: 'See this channel in the list. Hidden channels do not exist for denied members.' },
  { key: 'connectVoice', label: 'Connect', description: 'Join this voice channel and hear others.' },
  { key: 'speak', label: 'Speak', description: 'Talk in this voice channel. Denied members join muted and cannot unmute.' },
  { key: 'stream', label: 'Stream', description: 'Share screen or camera in this voice channel.' }
]

export const TEXT_CHANNEL_PERMS: Array<{ key: ChannelPermKey; label: string; description: string }> = [
  { key: 'viewChannel', label: 'View Channel', description: 'See this channel in the list. Hidden channels do not exist for denied members.' },
  { key: 'sendMessages', label: 'Send Messages', description: 'Send messages in this channel.' },
  { key: 'attachFiles', label: 'Attach Files', description: 'Upload files and images in this channel.' },
  { key: 'addReactions', label: 'Add Reactions', description: 'Add emoji reactions in this channel.' },
  { key: 'manageMessages', label: 'Manage Messages', description: "Delete other members' messages in this channel." }
]

const TIER_RANK: Record<string, number> = { member: 0, moderator: 1, host: 2 }

/** Does an overrides map contain any entry for the given key? */
function overridesTouch(overrides: ChannelOverrides | null | undefined, key: ChannelPermKey): boolean {
  if (!overrides) return false
  for (const entry of Object.values(overrides)) {
    if (entry && entry[key] !== undefined) return true
  }
  return false
}

/**
 * Resolve whether a member holds a channel-level permission.
 * Shared by the renderer (UI gating) and the main process (enforcement).
 */
export function resolveChannelPerm(opts: {
  tier: string
  roleIds: string[]
  roles: Array<{ id: string; permissions: number }>
  overrides: ChannelOverrides | null
  /** Legacy gates — honored only when no override touches the key. */
  minRole?: string | null
  allowedRoleIds?: string[] | null
  sendRoleIds?: string[] | null
  key: ChannelPermKey
}): boolean {
  const { tier, roleIds, roles, overrides, key } = opts
  if (tier === 'host') return true

  // Server-level base. viewChannel has no global bit — visible by default.
  let base = key === 'viewChannel'
    ? true
    : hasPerm(effectivePermissions(tier, roleIds, roles), PERM[key])

  if (overridesTouch(overrides, key)) {
    const ev = overrides?.['everyone']?.[key]
    if (ev !== undefined) base = ev === 'allow'
    const states: OverrideState[] = []
    for (const id of roleIds) {
      const st = overrides?.[id]?.[key]
      if (st !== undefined) states.push(st)
    }
    if (states.length > 0) base = states.includes('allow')
    return base
  }

  // Legacy gates (channels configured before overrides existed).
  if (key === 'viewChannel' || key === 'connectVoice') {
    if (opts.allowedRoleIds && opts.allowedRoleIds.length > 0) {
      base = base && opts.allowedRoleIds.some((id) => roleIds.includes(id))
    } else if (opts.minRole && opts.minRole !== 'member') {
      base = base && (TIER_RANK[tier] ?? 0) >= (TIER_RANK[opts.minRole] ?? 0)
    }
  }
  if (key === 'sendMessages' && opts.sendRoleIds && opts.sendRoleIds.length > 0) {
    base = base && opts.sendRoleIds.some((id) => roleIds.includes(id))
  }
  return base
}
