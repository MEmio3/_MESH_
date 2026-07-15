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

interface HostConnectionStatus {
  url: string
  role: 'primary' | 'secondary'
  state: 'connecting' | 'connected' | 'reconnecting' | 'offline'
  healthQuality: 'checking' | 'healthy' | 'degraded' | 'unreachable'
  latencyMs: number | null
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
  const [hostConnections, setHostConnections] = useState<HostConnectionStatus[]>([])

  useEffect(() => {
    let cancelled = false
    const refresh = async (): Promise<void> => {
      const [isConnected, relayStatus, statuses] = await Promise.all([
        window.api.signaling.isConnected().catch(() => false),
        window.api.relay.status().catch(() => null),
        window.api.signaling.listHostStatuses().catch(() => [])
      ])
      if (cancelled) return
      setConnected(isConnected)
      setRelay(relayStatus)
      setHostConnections(statuses)
    }
    void refresh()
    const offStatuses = window.api.signaling.onHostStatusesChanged(setHostConnections)
    const interval = setInterval(refresh, 5000)
    return () => {
      cancelled = true
      offStatuses()
      clearInterval(interval)
    }
  }, [])

  const activeUrl = normalizeNetworkUrl(network.signalingUrl || 'http://localhost:3000')
  const primary = hostConnections.find((host) => host.role === 'primary' && normalizeNetworkUrl(host.url) === activeUrl)
  const connectionTone = primary?.state === 'connected' && primary.healthQuality === 'healthy'
    ? 'online'
    : primary?.state === 'connecting' || primary?.state === 'reconnecting' || primary?.healthQuality === 'checking' || primary?.healthQuality === 'degraded'
      ? 'busy'
      : primary?.state === 'offline' || primary?.healthQuality === 'unreachable'
        ? 'offline'
        : connected
          ? 'online'
          : 'offline'
  const connectionValue = primary?.state === 'connected'
    ? `${hostFromUrl(activeUrl)}${primary.latencyMs == null ? '' : ` - ${primary.latencyMs} ms`}`
    : primary?.state === 'reconnecting'
      ? 'Reconnecting'
      : primary?.state === 'connecting'
        ? 'Connecting'
        : primary?.state === 'offline'
          ? 'Offline, retrying'
          : hostFromUrl(activeUrl)

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
          value={connectionValue}
          active={connected}
          tone={connectionTone}
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
  active,
  tone
}: {
  icon: JSX.Element
  label: string
  value: string
  active: boolean
  tone?: 'online' | 'busy' | 'offline'
}): JSX.Element {
  const resolvedTone = tone ?? (active ? 'online' : 'offline')
  return (
    <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-mesh-text-primary">
        <span className={cn(
          'text-mesh-text-muted',
          resolvedTone === 'online' && 'text-mesh-green',
          resolvedTone === 'busy' && 'text-mesh-warning',
          resolvedTone === 'offline' && 'text-mesh-danger'
        )}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          resolvedTone === 'online' && 'bg-mesh-green',
          resolvedTone === 'busy' && 'bg-mesh-warning animate-pulse',
          resolvedTone === 'offline' && 'bg-mesh-danger'
        )} />
        <div className="truncate font-mono text-[11px] text-mesh-text-muted">{value}</div>
      </div>
    </div>
  )
}

export { NetworkCenterSidePanel }
