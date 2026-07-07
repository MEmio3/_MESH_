import { Compass, Radio } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings.store'

function normalizeNetworkUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

function DiscoverySidePanel(): JSX.Element {
  const network = useSettingsStore((s) => s.network)
  const activeUrl = normalizeNetworkUrl(network.signalingUrl || 'http://localhost:3000')
  const savedCount = network.knownNetworks.length

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-mesh-border/50 px-4">
        <Compass className="h-4 w-4 text-mesh-green" />
        <span className="text-sm font-semibold text-mesh-text-primary">Discovery</span>
      </div>

      <div className="space-y-4 p-3">
        <div>
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-mesh-text-muted">
            Active Network
          </div>
          <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-mesh-text-primary">
              <Radio className="h-3.5 w-3.5 text-mesh-green" />
              Current
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-mesh-text-muted">{activeUrl}</div>
          </div>
        </div>

        <div>
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-mesh-text-muted">
            Saved Hosts
          </div>
          <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3 text-sm text-mesh-text-secondary">
            {savedCount} saved
          </div>
        </div>
      </div>
    </div>
  )
}

export { DiscoverySidePanel }
