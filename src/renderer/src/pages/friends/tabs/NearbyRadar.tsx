import { useMemo, useState } from 'react'
import { UserPlus, MessageSquare, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useAvatarStore } from '@/stores/avatar.store'
import { useIdentityStore } from '@/stores/identity.store'
import { cn } from '@/lib/utils'

export interface RadarUser {
  userId: string
  username: string
  avatarColor: string | null
}

interface NearbyRadarProps {
  users: RadarUser[]
  onAdd: (user: RadarUser) => void
  onMessage: (user: RadarUser) => void
  busyId?: string | null
}

// Vertical compression of the rings → the "looking across a tilted table" look
// that gives the radar depth instead of a flat top-down circle.
const TILT = 0.56
// How far out (in % of the radar half-width) the outermost blip band reaches.
const REACH = 41

/** Stable 32-bit hash so a user always lands in the same spot on the radar. */
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
  depth: number // 0 (far/back) → 1 (near/front)
}

function placeUsers(users: RadarUser[]): Placed[] {
  return users.map((u, i) => {
    const h = hashString(u.userId)
    // Spread angles roughly evenly (golden-angle) then jitter by the hash so it
    // feels organic but never overlaps the center or clusters.
    const angle = (i * 137.508 + (h % 360)) * (Math.PI / 180)
    const t = 0.46 + ((h >>> 9) % 1000) / 1000 * 0.52 // 0.46 → 0.98 of REACH
    const nx = Math.cos(angle) * t
    const ny = Math.sin(angle) * t
    const depth = (ny + 1) / 2 // front (ny>0, lower on screen) is nearer
    return {
      ...u,
      leftPct: 50 + nx * REACH,
      topPct: 51 + ny * REACH * TILT,
      scale: 0.78 + depth * 0.34,
      z: Math.round(depth * 100) + 10,
      depth
    }
  })
}

function Ring({ sizePct, opacity }: { sizePct: number; opacity: number }): JSX.Element {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-[51%] rounded-[50%] border border-mesh-border-light"
      style={{
        width: `${sizePct}%`,
        height: `${sizePct * TILT}%`,
        transform: 'translate(-50%, -50%)',
        opacity,
        boxShadow: 'inset 0 0 24px rgba(0,0,0,0.45)'
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
  const selectedUser = placed.find((p) => p.userId === selected) ?? null

  return (
    <div className="px-2">
      <div
        className="relative mx-auto aspect-square w-full max-w-[440px] select-none overflow-hidden rounded-2xl border border-mesh-border/70"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 8%, color-mix(in srgb, var(--color-mesh-green-glow) 22%, transparent), transparent 55%),' +
            'radial-gradient(80% 70% at 50% 52%, rgba(255,255,255,0.03), transparent 60%),' +
            'radial-gradient(130% 120% at 50% 55%, transparent 55%, rgba(0,0,0,0.55) 100%),' +
            'var(--color-mesh-bg-primary)'
        }}
        onClick={() => setSelected(null)}
      >
        {/* dotted grid texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              'radial-gradient(circle, color-mix(in srgb, var(--color-mesh-text-muted) 32%, transparent) 1px, transparent 1.4px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(120% 90% at 50% 52%, black 30%, transparent 78%)'
          }}
        />

        {/* concentric rings (far → near) */}
        <Ring sizePct={86} opacity={0.35} />
        <Ring sizePct={62} opacity={0.5} />
        <Ring sizePct={38} opacity={0.65} />

        {/* rotating sonar sweep, compressed into the tilted ellipse */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ transform: `scaleY(${TILT})`, transformOrigin: '50% 51%' }}
        >
          <div
            className="radar-sweep absolute left-1/2 top-[51%] aspect-square w-[86%] rounded-full"
            style={{
              transform: 'translate(-50%, -50%)',
              transformOrigin: 'center',
              background:
                'conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--color-mesh-green) 42%, transparent) 34deg, transparent 74deg)',
              WebkitMaskImage: 'radial-gradient(circle, black 30%, rgba(0,0,0,0.35) 60%, transparent 74%)',
              maskImage: 'radial-gradient(circle, black 30%, rgba(0,0,0,0.35) 60%, transparent 74%)'
            }}
          />
        </div>

        {/* sonar pings emanating from the center */}
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="radar-ping pointer-events-none absolute left-1/2 top-[51%] aspect-square w-[86%] rounded-[50%] border border-mesh-green/40"
            style={{ transform: 'translate(-50%, -50%)', height: `${86 * TILT}%`, animationDelay: `${i * 1.13}s` }}
          />
        ))}

        {/* center — you */}
        <div className="absolute left-1/2 top-[51%] z-[120] -translate-x-1/2 -translate-y-1/2">
          <div className="relative grid place-items-center">
            <div
              className="absolute h-16 w-16 rounded-full blur-md"
              style={{ background: 'var(--color-mesh-green-glow)' }}
            />
            <div className="relative rounded-full p-[3px] shadow-[0_8px_28px_rgba(0,0,0,0.55)] ring-2 ring-mesh-green/70">
              <Avatar fallback={identity?.username || 'You'} size="md" src={selfAvatar} color={(identity as unknown as { avatarPath?: string | null })?.avatarPath} />
            </div>
            <span className="mt-1.5 rounded-full border border-mesh-border/60 bg-mesh-bg-primary/70 px-2 py-0.5 text-[10px] font-semibold text-mesh-text-secondary backdrop-blur">
              You
            </span>
          </div>
        </div>

        {/* blips */}
        {placed.map((p) => {
          const isSel = p.userId === selected
          return (
            <button
              key={p.userId}
              onClick={(e) => {
                e.stopPropagation()
                setSelected((cur) => (cur === p.userId ? null : p.userId))
              }}
              className="radar-blip-in absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none"
              style={{ left: `${p.leftPct}%`, top: `${p.topPct}%`, zIndex: isSel ? 200 : p.z }}
              title={p.username}
            >
              <span className="radar-float relative grid place-items-center" style={{ transform: `scale(${p.scale})` }}>
                {/* ground shadow for depth */}
                <span
                  className="absolute top-[86%] h-2 w-8 rounded-[50%] bg-black/55 blur-[3px]"
                  style={{ opacity: 0.35 + p.depth * 0.4 }}
                />
                <span
                  className={cn(
                    'relative rounded-full p-[2px] transition-transform',
                    isSel ? 'ring-2 ring-mesh-green' : 'ring-1 ring-mesh-border-light'
                  )}
                  style={{
                    filter: `brightness(${0.82 + p.depth * 0.22})`,
                    boxShadow: `0 ${4 + p.depth * 8}px ${8 + p.depth * 14}px rgba(0,0,0,${0.35 + p.depth * 0.2})`
                  }}
                >
                  <Avatar fallback={p.username} size="sm" src={avatarsByUser[p.userId]} color={p.avatarColor} />
                </span>
                <span className="pointer-events-none mt-1 block max-w-[74px] truncate rounded bg-mesh-bg-primary/70 px-1.5 text-center text-[9px] font-medium text-mesh-text-secondary backdrop-blur">
                  {p.username}
                </span>
              </span>
            </button>
          )
        })}

        {/* action popover for the selected blip */}
        {selectedUser && (
          <div
            className="absolute z-[300] w-44 -translate-x-1/2 rounded-xl border border-mesh-border/70 bg-mesh-bg-secondary/97 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur"
            style={{
              left: `${Math.min(80, Math.max(20, selectedUser.leftPct))}%`,
              top: `${Math.min(72, Math.max(10, selectedUser.topPct + 8))}%`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <Avatar fallback={selectedUser.username} size="xs" src={avatarsByUser[selectedUser.userId]} color={selectedUser.avatarColor} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-mesh-text-primary">{selectedUser.username}</span>
              <button onClick={() => setSelected(null)} className="text-mesh-text-muted hover:text-mesh-text-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              onClick={() => { onAdd(selectedUser); setSelected(null) }}
              disabled={busyId === selectedUser.userId}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-mesh-text-secondary transition-colors hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" /> Add friend
            </button>
            <button
              onClick={() => { onMessage(selectedUser); setSelected(null) }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-mesh-text-secondary transition-colors hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Message
            </button>
          </div>
        )}

        {/* empty state */}
        {users.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center">
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-mesh-text-muted">
              No signals detected
            </span>
          </div>
        )}
      </div>

      <p className="mx-auto mt-3 max-w-[440px] text-center text-[11px] text-mesh-text-muted">
        Tap a signal to add or message them. People appear as they connect to a host you share.
      </p>
    </div>
  )
}

export { NearbyRadar }
