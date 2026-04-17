import { useEffect, useState } from 'react'
import { Users, UserPlus, Copy, Check, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { Badge } from '@/components/ui/Badge'
import { Separator } from '@/components/ui/Separator'
import { OnlineFriendsTab } from './tabs/OnlineFriendsTab'
import { AllFriendsTab } from './tabs/AllFriendsTab'
import { PendingTab } from './tabs/PendingTab'
import { BlockedTab } from './tabs/BlockedTab'
import { AddFriendTab } from './tabs/AddFriendTab'
import { NearbyTab } from './tabs/NearbyTab'
import { MessageRequestPanel } from '@/components/social/MessageRequestPanel'

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add' | 'messages' | 'nearby'

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
  { id: 'messages', label: 'Requests' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'add', label: 'Add Friend', variant: 'green' },
]

function FriendsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('online')
  const pendingCount = useFriendsStore((s) => s.friendRequests.filter((r) => r.direction === 'incoming').length)
  // Only surface requests that still need attention — once a request has been
  // replied to, the thread already lives in the DM sidebar and doesn't belong
  // in "Requests" anymore.
  const messageCount = useFriendsStore(
    (s) => s.messageRequests.filter((r) => r.status !== 'replied').length
  )
  const userId = useIdentityStore((s) => s.identity?.userId)
  const [copied, setCopied] = useState(false)
  const [connected, setConnected] = useState(true)

  // Watch signaling connection state so we can show a banner when offline.
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
    <div className="flex flex-col h-full">
      {/* Header with tabs */}
      <div className="flex items-center h-12 px-4 border-b border-mesh-border shrink-0">
        <Users className="h-5 w-5 text-mesh-text-muted mr-2" />
        <span className="text-sm font-semibold text-mesh-text-primary">Friends</span>
        <div className="w-px h-5 bg-mesh-border mx-3 shrink-0" />

        {/* Tabs */}
        <div className="flex items-center gap-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            const badgeCount = tab.id === 'pending' ? pendingCount : tab.id === 'messages' ? messageCount : 0

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative px-2 py-1 text-sm font-medium transition-colors',
                  tab.variant === 'green'
                    ? isActive
                      ? 'bg-mesh-green text-white rounded'
                      : 'bg-transparent text-mesh-green border border-mesh-green rounded hover:bg-mesh-green/10'
                    : isActive
                      ? 'bg-mesh-bg-tertiary text-mesh-text-primary rounded'
                      : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary rounded'
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

      {/* Connection status banner (Fix 4) */}
      {!connected && (
        <div className="mx-4 mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-2.5 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
          <div className="flex-1 text-xs text-yellow-100">
            Not connected to a signaling server.{' '}
            <Link to="/settings/connection" className="underline font-medium hover:text-yellow-50">
              Go to Settings → Connection
            </Link>{' '}
            to connect.
          </div>
        </div>
      )}

      {/* User ID card (Fix 3) */}
      <div className="mx-4 mt-3 rounded-lg bg-mesh-bg-secondary border border-mesh-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-mesh-text-secondary uppercase tracking-wide">
              Your ID — share this to receive friend requests
            </p>
            <code className="text-sm text-mesh-green font-mono truncate block mt-0.5">
              {userId || 'usr_not_generated'}
            </code>
          </div>
          <button
            onClick={handleCopyId}
            disabled={!userId}
            className="shrink-0 h-8 w-8 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors disabled:opacity-50"
            title="Copy your ID"
          >
            {copied ? <Check className="h-4 w-4 text-mesh-green" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto py-3">
        {activeTab === 'online' && <OnlineFriendsTab />}
        {activeTab === 'all' && <AllFriendsTab />}
        {activeTab === 'pending' && <PendingTab />}
        {activeTab === 'blocked' && <BlockedTab />}
        {activeTab === 'messages' && <MessageRequestPanel />}
        {activeTab === 'nearby' && <NearbyTab />}
        {activeTab === 'add' && <AddFriendTab />}
      </div>
    </div>
  )
}

export { FriendsPage }
