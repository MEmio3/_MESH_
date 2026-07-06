import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, Sparkles, UserPlus, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { Badge } from '@/components/ui/Badge'
import { OnlineFriendsTab } from './tabs/OnlineFriendsTab'
import { AllFriendsTab } from './tabs/AllFriendsTab'
import { PendingTab } from './tabs/PendingTab'
import { BlockedTab } from './tabs/BlockedTab'
import { AddFriendTab } from './tabs/AddFriendTab'
import { NearbyTab } from './tabs/NearbyTab'

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add' | 'nearby'

interface TabDef {
  id: Tab
  label: string
  variant?: 'default' | 'green'
}

const tabs: TabDef[] = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'add', label: 'Add Friend', variant: 'green' },
]

function FriendsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('online')
  const friends = useFriendsStore((s) => s.friends)
  const pendingCount = useFriendsStore((s) => s.friendRequests.filter((r) => r.direction === 'incoming').length)
  const userId = useIdentityStore((s) => s.identity?.userId)
  const [copied, setCopied] = useState(false)
  const [connected, setConnected] = useState(true)
  const onlineCount = friends.filter((friend) => friend.status !== 'offline').length

  useEffect(() => {
    let cancelled = false
    window.api.signaling.isConnected().then((c) => { if (!cancelled) setConnected(c) })
    const offConn = window.api.signaling.onConnected(() => setConnected(true))
    const offDisc = window.api.signaling.onDisconnected(() => setConnected(false))
    const interval = setInterval(() => {
      window.api.signaling.isConnected().then((c) => { if (!cancelled) setConnected(c) })
    }, 5000)
    return () => {
      cancelled = true
      offConn()
      offDisc()
      clearInterval(interval)
    }
  }, [])

  const handleCopyId = (): void => {
    if (!userId) return
    navigator.clipboard.writeText(userId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-mesh-border/60 bg-mesh-bg-secondary/45 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-mesh-green/25 bg-mesh-green/12 text-mesh-green">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <span className="block text-sm font-semibold text-mesh-text-primary">Friends</span>
              <span className="block text-xs text-mesh-text-muted">{onlineCount} online - {friends.length} total</span>
            </div>
          </div>
          <div className="hidden items-center gap-1.5 rounded-full border border-mesh-border/60 bg-mesh-bg-tertiary/55 px-3 py-1 text-xs text-mesh-text-secondary sm:inline-flex">
            <Sparkles className="h-3.5 w-3.5 text-mesh-green" />
            Social mesh
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            const badgeCount = tab.id === 'pending' ? pendingCount : 0

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors',
                  tab.variant === 'green'
                    ? isActive
                      ? 'border-mesh-green bg-mesh-green text-white shadow-[0_10px_24px_rgba(35,165,89,0.18)]'
                      : 'border-mesh-green/40 bg-mesh-green/10 text-mesh-green hover:bg-mesh-green/16'
                    : isActive
                      ? 'border-mesh-border/70 bg-mesh-bg-tertiary text-mesh-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
                      : 'border-transparent text-mesh-text-secondary hover:border-mesh-border/45 hover:bg-mesh-bg-tertiary/65 hover:text-mesh-text-primary'
                )}
              >
                <span className="flex items-center gap-1.5">
                  {tab.id === 'add' && <UserPlus className="h-3.5 w-3.5" />}
                  {tab.label}
                  {badgeCount > 0 && <Badge count={badgeCount} />}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {!connected && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
          <div className="flex-1 text-xs text-yellow-100">
            Not connected to a signaling server.{' '}
            <Link to="/settings/connection" className="font-medium underline hover:text-yellow-50">
              Go to Settings - Connection
            </Link>{' '}
            to connect.
          </div>
        </div>
      )}

      <div className="mx-4 mt-3 overflow-hidden rounded-xl border border-mesh-border/70 bg-mesh-bg-secondary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="h-1 bg-gradient-to-r from-mesh-green via-mesh-info to-mesh-green" />
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary">
              Your ID
            </p>
            <code className="mt-0.5 block truncate font-mono text-sm text-mesh-green">
              {userId || 'usr_not_generated'}
            </code>
          </div>
          <button
            onClick={handleCopyId}
            disabled={!userId}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-mesh-border/60 bg-mesh-bg-tertiary text-mesh-text-muted transition-colors hover:bg-mesh-bg-hover hover:text-mesh-text-primary disabled:opacity-50"
            title="Copy your ID"
          >
            {copied ? <Check className="h-4 w-4 text-mesh-green" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {activeTab === 'online' && <OnlineFriendsTab />}
        {activeTab === 'all' && <AllFriendsTab />}
        {activeTab === 'pending' && <PendingTab />}
        {activeTab === 'blocked' && <BlockedTab />}
        {activeTab === 'nearby' && <NearbyTab />}
        {activeTab === 'add' && <AddFriendTab />}
      </div>
    </div>
  )
}

export { FriendsPage }
