import { useMemo, useState } from 'react'
import { MessageSquare, UserPlus, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useAvatarStore } from '@/stores/avatar.store'
import { useIdentityStore } from '@/stores/identity.store'
import { cn } from '@/lib/utils'

export interface RadarUser {
  userId: string
  username: string
  avatarColor: string | null
  hostUrls?: string[]
}

interface NearbyRadarProps {
  users: RadarUser[]
  onAdd: (user: RadarUser) => void
  onMessage: (user: RadarUser) => void
  busyId?: string | null
}

const CENTER_X = 50
const CENTER_Y = 50
const X_REACH = 34
const Y_REACH = 34

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface Placed extends RadarUser {
  leftPct: number
  topPct: number
  scale: number
  z: number
  delay: number
  strength: number
}

function placeUsers(users: RadarUser[]): Placed[] {
  return users.map((user, index) => {
    const hash = hashString(user.userId)
    const angle = (index * 137.508 + (hash % 120)) * (Math.PI / 180)
    const radius = 0.28 + (((hash >>> 8) % 1000) / 1000) * 0.7
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    const depth = (y + 1) / 2

    return {
      ...user,
      leftPct: CENTER_X + x * X_REACH,
      topPct: CENTER_Y + y * Y_REACH,
      scale: 0.86 + depth * 0.28,
      z: 20 + Math.round(depth * 80),
      delay: (hash % 900) / 100,
      strength: Math.round(48 + (1 - radius) * 42 + depth * 10)
    }
  })
}

function Ring({ size, strong = false }: { size: number; strong?: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        'nearby-map-ring pointer-events-none absolute aspect-square rounded-full',
        strong && 'nearby-map-ring-strong'
      )}
      style={{
        left: `${CENTER_X}%`,
        top: `${CENTER_Y}%`,
        width: `min(${Math.round(size * 4)}px, calc(100vw - 92px))`
      }}
    />
  )
}

function NearbyRadar({ users, onAdd, onMessage, busyId }: NearbyRadarProps): JSX.Element {
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)
  const identity = useIdentityStore((s) => s.identity)
  const [selected, setSelected] = useState<string | null>(null)

  const placed = useMemo(() => placeUsers(users), [users])
  const selectedUser = placed.find((user) => user.userId === selected) ?? null

  return (
    <section
      className="nearby-map-shell relative -mx-4 min-h-[660px] overflow-visible bg-transparent"
      onClick={() => setSelected(null)}
    >
      <div
        className="nearby-map-sweep pointer-events-none absolute aspect-square rounded-full"
        style={{ left: `${CENTER_X}%`, top: `${CENTER_Y}%`, width: 'min(660px, calc(100vw - 72px))' }}
      />

      <Ring size={26} strong />
      <Ring size={44} />
      <Ring size={66} />
      <Ring size={92} />
      <Ring size={122} />
      <Ring size={154} />

      <div
        className="pointer-events-none absolute h-px bg-gradient-to-r from-transparent via-mesh-green/35 to-transparent"
        style={{ left: '9%', right: '9%', top: `${CENTER_Y}%` }}
      />
      <div
        className="pointer-events-none absolute w-px bg-gradient-to-b from-transparent via-mesh-green/24 to-transparent"
        style={{ left: `${CENTER_X}%`, top: '20%', bottom: '13%' }}
      />

      <div
        className="absolute z-[130] -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${CENTER_X}%`, top: `${CENTER_Y}%` }}
      >
        <div className="relative grid h-24 w-24 place-items-center">
          <span className="nearby-map-self-pulse absolute h-40 w-40 rounded-full" />
          <span className="absolute h-32 w-32 rounded-full bg-mesh-green/18 blur-xl" />
          <span className="relative rounded-full border border-white/25 bg-mesh-bg-primary/75 p-1.5 shadow-[0_20px_54px_rgba(0,0,0,0.58)] backdrop-blur">
            <Avatar
              fallback={identity?.username || 'You'}
              size="xl"
              src={selfAvatar}
              color={(identity as unknown as { avatarPath?: string | null })?.avatarPath}
            />
          </span>
          <span className="absolute left-1/2 top-[calc(100%+5px)] -translate-x-1/2 rounded-full border border-mesh-border/70 bg-mesh-bg-primary/80 px-2 py-0.5 text-[10px] font-bold text-mesh-text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.25)] backdrop-blur">
            You
          </span>
        </div>
      </div>

      {placed.map((user) => {
        const selectedNode = user.userId === selected
        return (
          <button
            key={user.userId}
            className="nearby-map-node absolute -translate-x-1/2 -translate-y-1/2 text-left focus:outline-none"
            style={{
              left: `${user.leftPct}%`,
              top: `${user.topPct}%`,
              zIndex: selectedNode ? 220 : user.z,
              animationDelay: `${user.delay}s`,
              transform: `translate(-50%, -50%) scale(${user.scale})`
            }}
            title={user.username}
            onClick={(event) => {
              event.stopPropagation()
              setSelected((current) => (current === user.userId ? null : user.userId))
            }}
          >
            <span className="relative grid place-items-center">
              <span className="absolute top-[88%] h-2 w-10 rounded-[50%] bg-black/55 blur-[4px]" />
              <span className={cn(
                'relative rounded-full border bg-mesh-bg-primary/85 p-[3px] shadow-[0_14px_34px_rgba(0,0,0,0.48)] transition',
                selectedNode ? 'border-mesh-green ring-4 ring-mesh-green/18' : 'border-white/18 ring-2 ring-mesh-green/10'
              )}>
                <Avatar
                  fallback={user.username}
                  size="sm"
                  src={avatarsByUser[user.userId]}
                  color={user.avatarColor}
                />
                <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-mesh-bg-primary bg-mesh-green shadow-[0_0_18px_rgba(35,255,210,0.65)]" />
              </span>
              <span className="mt-1 max-w-[86px] truncate rounded-full border border-mesh-border/60 bg-mesh-bg-primary/82 px-2 py-0.5 text-center text-[10px] font-semibold text-mesh-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur">
                {user.username}
              </span>
            </span>
          </button>
        )
      })}

      {selectedUser && (
        <div
          className="absolute z-[320] w-52 -translate-x-1/2 rounded-xl border border-mesh-border/70 bg-mesh-bg-secondary/95 p-2 shadow-[0_24px_70px_rgba(0,0,0,0.56)] backdrop-blur-xl"
          style={{
            left: `${Math.min(82, Math.max(18, selectedUser.leftPct))}%`,
            top: `${Math.min(76, Math.max(12, selectedUser.topPct + 9))}%`
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-center gap-2 px-1">
            <Avatar
              fallback={selectedUser.username}
              size="xs"
              src={avatarsByUser[selectedUser.userId]}
              color={selectedUser.avatarColor}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-mesh-text-primary">{selectedUser.username}</p>
              <p className="text-[10px] text-mesh-text-muted">
                {selectedUser.strength}% signal - {selectedUser.hostUrls?.length ?? 1} shared host{(selectedUser.hostUrls?.length ?? 1) === 1 ? '' : 's'}
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="grid h-6 w-6 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => { onAdd(selectedUser); setSelected(null) }}
              disabled={busyId === selectedUser.userId}
              className="mesh-pressable flex h-9 items-center justify-center gap-1.5 rounded-lg bg-mesh-green/16 text-xs font-bold text-mesh-green transition hover:bg-mesh-green hover:text-white disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add
            </button>
            <button
              onClick={() => { onMessage(selectedUser); setSelected(null) }}
              className="mesh-pressable flex h-9 items-center justify-center gap-1.5 rounded-lg bg-mesh-bg-tertiary text-xs font-bold text-mesh-text-secondary transition hover:text-mesh-text-primary"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              DM
            </button>
          </div>
        </div>
      )}

      {users.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[180] text-center">
          <span className="rounded-full border border-mesh-border/70 bg-mesh-bg-primary/72 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.24em] text-mesh-text-muted shadow-[0_16px_42px_rgba(0,0,0,0.34)] backdrop-blur">
            No signals detected
          </span>
        </div>
      )}
    </section>
  )
}

export { NearbyRadar }
