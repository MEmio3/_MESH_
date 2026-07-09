import { useEffect, useState } from 'react'
import { RefreshCw, UserPlus, MessageSquare, Wifi, List, Radar } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useDiscoveryStore } from '@/stores/discovery.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { cn } from '@/lib/utils'
import { NearbyRadar, type RadarUser } from './NearbyRadar'

type View = 'radar' | 'list'

function NearbyTab(): JSX.Element {
  const nearby = useDiscoveryStore((s) => s.nearby)
  const loading = useDiscoveryStore((s) => s.loading)
  const refresh = useDiscoveryStore((s) => s.refresh)
  const sendFriendRequest = useFriendsStore((s) => s.sendFriendRequest)
  const sendMessageRequest = useFriendsStore((s) => s.sendMessageRequest)
  const identity = useIdentityStore((s) => s.identity)

  const [view, setView] = useState<View>('radar')
  const [composeFor, setComposeFor] = useState<string | null>(null)
  const [msgDraft, setMsgDraft] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => { refresh() }, [refresh])

  const visible = nearby.filter((u) => u.userId !== identity?.userId)

  const handleAdd = async (u: RadarUser): Promise<void> => {
    setBusyId(u.userId)
    const res = await sendFriendRequest(u.userId)
    setStatus(res.success ? `Friend request sent to ${u.username}` : (res.error ?? 'Failed'))
    setBusyId(null)
  }
  const handleMessage = (u: RadarUser): void => { setComposeFor(u.userId); setMsgDraft('') }

  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide">
            People Nearby — {visible.length}
          </h3>
          <p className="text-xs text-mesh-text-muted mt-0.5">
            Users connected to a host you share.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* List / Radar segmented toggle */}
          <div className="flex items-center rounded-lg border border-mesh-border/70 bg-mesh-bg-tertiary/50 p-0.5">
            <ToggleBtn active={view === 'radar'} onClick={() => setView('radar')} title="Radar view">
              <Radar className="h-3.5 w-3.5" />
            </ToggleBtn>
            <ToggleBtn active={view === 'list'} onClick={() => setView('list')} title="List view">
              <List className="h-3.5 w-3.5" />
            </ToggleBtn>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="h-8 w-8 flex items-center justify-center rounded-md text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {status && <p className="text-xs text-mesh-green mb-2">{status}</p>}

      {view === 'radar' ? (
        <NearbyRadar users={visible} onAdd={handleAdd} onMessage={handleMessage} busyId={busyId} />
      ) : (
        <>
          {visible.length === 0 && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
              <Wifi className="h-16 w-16 text-mesh-text-muted mb-4 stroke-1" />
              <h3 className="text-lg font-semibold text-mesh-text-primary mb-2">Nobody nearby</h3>
              <p className="text-sm text-mesh-text-muted max-w-xs text-center mb-8">
                There are no active users connected to a host you share.
              </p>
            </div>
          )}

          <ul className="space-y-1">
            {visible.map((u) => (
              <li
                key={u.userId}
                className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-mesh-bg-tertiary/50"
              >
                <Avatar fallback={u.username} size="sm" color={u.avatarColor} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-mesh-text-primary truncate">{u.username}</div>
                  <div className="text-[11px] text-mesh-text-muted font-mono truncate">{u.userId}</div>
                </div>
                <button
                  onClick={() => handleAdd(u)}
                  disabled={busyId === u.userId}
                  className="h-8 px-2.5 rounded-md text-xs flex items-center gap-1.5 text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary disabled:opacity-50"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Add
                </button>
                <button
                  onClick={() => handleMessage(u)}
                  className="h-8 px-2.5 rounded-md text-xs flex items-center gap-1.5 text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Message
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {composeFor && (
        <div className="mt-4 p-3 rounded-md border border-mesh-border bg-mesh-bg-tertiary/40">
          <div className="text-xs text-mesh-text-secondary mb-2">
            Message request to <span className="font-mono">{composeFor}</span>
          </div>
          <textarea
            value={msgDraft}
            onChange={(e) => setMsgDraft(e.target.value)}
            placeholder="Write a short intro..."
            rows={3}
            className="w-full rounded-md bg-mesh-bg-primary border border-mesh-border p-2 text-sm text-mesh-text-primary focus:outline-none focus:ring-2 focus:ring-mesh-green"
          />
          <div className="flex gap-2 mt-2">
            <Button
              onClick={async () => {
                if (!composeFor || msgDraft.trim().length === 0) return
                const res = await sendMessageRequest(composeFor, msgDraft.trim())
                if (res.success) {
                  setStatus('Message request sent.')
                  setComposeFor(null); setMsgDraft('')
                } else {
                  setStatus(res.error ?? 'Failed to send message request.')
                }
              }}
              disabled={msgDraft.trim().length === 0}
            >
              Send
            </Button>
            <button
              onClick={() => { setComposeFor(null); setMsgDraft('') }}
              className="text-xs px-3 text-mesh-text-muted hover:text-mesh-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ToggleBtn({ active, onClick, title, children }: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'grid h-7 w-8 place-items-center rounded-md transition-colors',
        active
          ? 'bg-mesh-bg-primary text-mesh-green shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
          : 'text-mesh-text-muted hover:text-mesh-text-primary'
      )}
    >
      {children}
    </button>
  )
}

export { NearbyTab }
