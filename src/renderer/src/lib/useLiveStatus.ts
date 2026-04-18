import { useIdentityStore } from '@/stores/identity.store'
import { useStatusStore } from '@/stores/status.store'
import { useFriendsStore } from '@/stores/friends.store'

export type PresenceStatus = 'online' | 'idle' | 'offline' | 'dnd'

/**
 * Resolve a user's current presence from the authoritative stores, falling
 * back to a supplied snapshot. Used wherever a status dot needs to stay in
 * sync across the app (DM list, server member list, friend list) — without
 * each surface having its own ad-hoc subscription.
 *
 * Resolution order:
 *  1. If `userId` is the self user → read from `useStatusStore.self`.
 *  2. If the user is a known friend with a live status → read from
 *     `useStatusStore.friendStatuses` (populated by `onStatusChanged` /
 *     `onStatusSnapshot`).
 *  3. Else fall back to the friends-store row (DB-persisted `status`).
 *  4. Else fall back to the caller-supplied `fallback` (typically the
 *     `ServerMember.status` snapshot the component already had).
 */
export function useLiveStatus(
  userId: string | undefined,
  fallback?: PresenceStatus | string | null
): PresenceStatus {
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfStatus = useStatusStore((s) => s.self)
  const friendStatuses = useStatusStore((s) => s.friendStatuses)
  const friends = useFriendsStore((s) => s.friends)

  if (!userId) return normalize(fallback)
  if (userId === selfId) return selfStatus
  const live = friendStatuses[userId]?.status
  if (live) return live
  const friend = friends.find((f) => f.userId === userId)
  if (friend?.status) return normalize(friend.status)
  return normalize(fallback)
}

function normalize(v: unknown): PresenceStatus {
  if (v === 'online' || v === 'idle' || v === 'dnd') return v
  return 'offline'
}
