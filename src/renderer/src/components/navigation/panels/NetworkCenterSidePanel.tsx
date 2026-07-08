import { useEffect, useState } from 'react'
import { PlugZap, Radio, Router, Server, Wifi } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings.store'
import { useServersStore } from '@/stores/servers.store'
import { cn } from '@/lib/utils'

interface RelayStatus {
  running: boolean
  port: number
  scope: 'isp-local' | 'global'
  connections: number
  advertisedAddress: string | null
}

function normalizeNetworkUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

function hostFromUrl(url: string): string {
  try {
    return new URL(normalizeNetworkUrl(url)).host
  } catch {
    return url
  }
}

function NetworkCenterSidePanel(): JSX.Element {
  const network = useSettingsStore((s) => s.network)
  const hostedCount = useServersStore((s) => s.servers.filter((server) => server.role === 'host').length)
  const [connected, setConnected] = useState(false)
  const [relay, setRelay] = useState<RelayStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = async (): Promise<void> => {
      const [isConnected, relayStatus] = await Promise.all([
        window.api.signaling.isConnected().catch(() => false),
        window.api.relay.status().catch(() => null)
      ])
      if (cancelled) return
      setConnected(isConnected)
      setRelay(relayStatus)
    }
    void refresh()
    const interval = setInterval(refresh, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const activeUrl = normalizeNetworkUrl(network.signalingUrl || 'http://localhost:3000')

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-mesh-border/50 px-4">
        <Router className="h-4 w-4 text-mesh-green" />
        <span className="text-sm font-semibold text-mesh-text-primary">Network Center</span>
      </div>

      <div className="space-y-4 p-3">
        <SummaryCard
          icon={<PlugZap className="h-3.5 w-3.5" />}
          label="Connection"
          value={hostFromUrl(activeUrl)}
          active={connected}
        />
        <SummaryCard
          icon={<Server className="h-3.5 w-3.5" />}
          label="Hosting"
          value={network.hostSignaling ? `${hostedCount} servers` : 'Off'}
          active={network.hostSignaling}
        />
        <SummaryCard
          icon={<Radio className="h-3.5 w-3.5" />}
          label="Relay"
          value={relay?.running ? relay.advertisedAddress ?? `:${relay.port}` : 'Off'}
          active={relay?.running ?? false}
        />

        <div>
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-mesh-text-muted">
            Saved Hosts
          </div>
          <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-mesh-text-primary">
              <Wifi className="h-3.5 w-3.5 text-mesh-green" />
              {network.knownNetworks.length} saved
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  active
}: {
  icon: JSX.Element
  label: string
  value: string
  active: boolean
}): JSX.Element {
  return (
    <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-mesh-text-primary">
        <span className={cn('text-mesh-text-muted', active && 'text-mesh-green')}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-mesh-green' : 'bg-mesh-text-muted')} />
        <div className="truncate font-mono text-[11px] text-mesh-text-muted">{value}</div>
      </div>
    </div>
  )
}

export { NetworkCenterSidePanel }
