/**
 * Per-server custom display names for the three role tiers.
 *
 * The permission ladder is fixed (host > moderator > member) — only the
 * labels change, so "CEO / Team Lead / Employee" works exactly like
 * "Host / Moderator / Member" underneath.
 */

export interface RoleNames {
  host: string
  moderator: string
  member: string
}

export const DEFAULT_ROLE_NAMES: RoleNames = {
  host: 'Host',
  moderator: 'Moderator',
  member: 'Member'
}

/** Merge a (possibly partial/null) custom set over the defaults. */
export function resolveRoleNames(custom?: Partial<RoleNames> | null): RoleNames {
  return {
    host: custom?.host?.trim() || DEFAULT_ROLE_NAMES.host,
    moderator: custom?.moderator?.trim() || DEFAULT_ROLE_NAMES.moderator,
    member: custom?.member?.trim() || DEFAULT_ROLE_NAMES.member
  }
}
