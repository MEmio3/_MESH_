import { useEffect, useState } from 'react'
import { Radio, Trash2, Plus, Router } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSettingsStore } from '@/stores/settings.store'
import { SettingRow } from '@/components/settings/SettingRow'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'

interface RelayRow {
  id: string
  address: string
  scope: string
  latency: number | null
  users: number
  isCustom: number
}

interface RelayStatus {
  running: boolean
  port: number
  scope: 'isp-local' | 'global'
  connections: number
  credentials: { username: string; password: string } | null
  advertisedAddress: string | null
  relayId: string | null
  error: string | null
}

function RelaySettings(): JSX.Element {
  const navigate = useNavigate()
  const network = useSettingsStore((s) => s.network)
  const { addCustomRelay, removeCustomRelay } = useSettingsStore()
  const [newRelay, setNewRelay] = useState('')

  const [registeredRelays, setRegisteredRelays] = useState<RelayRow[]>([])
  const [status, setStatus] = useState<RelayStatus | null>(null)
  const [relayScope, setRelayScope] = useState<'isp-local' | 'global'>('isp-local')

  const refreshStatus = async (): Promise<void> => {
    const s = await window.api.relay.status()
    setStatus(s)
  }

  const refreshRelays = async (): Promise<void> => {
    const rows = await window.api.db.relays.list()
    setRegisteredRelays(rows)
  }

  useEffect(() => {
    refreshStatus()
    refreshRelays()
    const interval = setInterval(refreshStatus, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleToggleContributing = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      // Pass the signaling URL so the relay registers itself, heartbeats,
      // and becomes discoverable by every peer — starting without
      // registering made the relay invisible to the entire network.
      const res = await window.api.relay.start({
        scope: relayScope,
        signalingUrl: network.signalingUrl || 'http://localhost:3000'
      })
      if (!res.success) {
        alert(`Failed to start relay: ${res.error}`)
      }
    } else {
      await window.api.relay.stop()
    }
    await refreshStatus()
    await refreshRelays()
  }

  const handleAddRelay = (): void => {
    const trimmed = newRelay.trim()
    if (trimmed && !network.customRelays.includes(trimmed)) {
      addCustomRelay(trimmed)
      setNewRelay('')
    }
  }

  const handleRemoveRegistered = async (id: string): Promise<void> => {
    await window.api.db.relays.remove(id)
    await refreshRelays()
  }

  const isContributing = status?.running ?? false

  return (
    <div className="max-w-2xl mx-auto py-6 px-6">
      <h2 className="text-lg font-bold text-mesh-text-primary mb-1">Relay Details</h2>
      <p className="mb-6 text-xs text-mesh-text-muted">
        Advanced relay controls. Use Network Center for the simple on/off flow.
      </p>

      <div className="mb-6 rounded-xl border border-mesh-border bg-mesh-bg-secondary p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-mesh-border/70 bg-mesh-bg-primary text-mesh-green">
              <Router className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-mesh-text-primary">Network Center</div>
              <div className="mt-0.5 text-xs text-mesh-text-muted">Start hosting, connect to hosts, and turn relay on from one place.</div>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate('/network-center')}>
            Open
          </Button>
        </div>
      </div>

      {/* Registered Relays */}
      <div className="mb-8">
        <h3 className="text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-3">
          Registered Relays
        </h3>
        {registeredRelays.length === 0 ? (
          <div className="rounded-lg border border-dashed border-mesh-border p-4 text-center">
            <span className="text-xs text-mesh-text-muted">
              No relays registered yet. Contribute your own below or add a custom relay address.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {registeredRelays.map((relay) => (
              <div
                key={relay.id}
                className="flex items-center gap-3 px-4 py-3 rounded-lg bg-mesh-bg-tertiary border border-mesh-border/50"
              >
                <div className="h-2 w-2 rounded-full bg-mesh-green" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-mesh-text-primary font-mono">{relay.address}</code>
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        relay.scope === 'global' ? 'bg-mesh-info/20 text-mesh-info' : 'bg-mesh-green/20 text-mesh-green'
                      }`}
                    >
                      {relay.scope === 'global' ? 'GLOBAL' : 'NEARBY'}
                    </span>
                  </div>
                  <span className="text-xs text-mesh-text-muted">
                    {relay.latency != null ? `${relay.latency}ms` : '—'} · {relay.users} users
                  </span>
                </div>
                <button
                  onClick={() => handleRemoveRegistered(relay.id)}
                  className="h-7 w-7 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-danger hover:bg-mesh-danger/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom Relays */}
      <div className="mb-8">
        <h3 className="text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-3">
          Custom Relays
        </h3>
        {network.customRelays.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-3">
            {network.customRelays.map((addr) => (
              <div
                key={addr}
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-mesh-bg-tertiary border border-mesh-border/50"
              >
                <code className="flex-1 text-sm text-mesh-text-primary font-mono">{addr}</code>
                <button
                  onClick={() => removeCustomRelay(addr)}
                  className="h-7 w-7 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-danger hover:bg-mesh-danger/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={newRelay}
            onChange={(e) => setNewRelay(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddRelay()}
            placeholder="turn:10.0.0.5:3478"
            className="flex-1 h-10 px-3 rounded-lg bg-mesh-bg-tertiary border border-mesh-border text-sm text-mesh-text-primary font-mono placeholder:text-mesh-text-muted focus:outline-none focus:ring-2 focus:ring-mesh-green"
          />
          <Button onClick={handleAddRelay} disabled={!newRelay.trim()} variant="secondary">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      {/* Become a Relay */}
      <div className="rounded-xl bg-mesh-bg-secondary border border-mesh-border p-5">
        <SettingRow
          label="Contribute as Relay"
          description="Share your bandwidth to help the MESH network. Your machine will act as a TURN relay for other users."
          separator={false}
        >
          <Toggle checked={isContributing} onChange={handleToggleContributing} />
        </SettingRow>

        {isContributing && status && (
          <div className="mt-3 pt-3 border-t border-mesh-border/30">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-mesh-bg-tertiary p-3">
                <span className="text-mesh-text-muted block mb-1">Status</span>
                <span className="text-mesh-green font-semibold flex items-center gap-1">
                  <Radio className="h-3 w-3" /> Running
                </span>
              </div>
              <div className="rounded-lg bg-mesh-bg-tertiary p-3">
                <span className="text-mesh-text-muted block mb-1">Scope</span>
                <span className="text-mesh-text-primary font-semibold">
                  {status.scope === 'global' ? 'Global' : 'Nearby'}
                </span>
              </div>
              <div className="rounded-lg bg-mesh-bg-tertiary p-3">
                <span className="text-mesh-text-muted block mb-1">Port</span>
                <span className="text-mesh-text-primary font-mono">{status.port}</span>
              </div>
              <div className="rounded-lg bg-mesh-bg-tertiary p-3">
                <span className="text-mesh-text-muted block mb-1">Connections</span>
                <span className="text-mesh-text-primary font-semibold">{status.connections}</span>
              </div>
              <div className="rounded-lg bg-mesh-bg-tertiary p-3 col-span-2">
                <span className="text-mesh-text-muted block mb-1">Advertised address</span>
                <span className="text-mesh-text-primary font-mono text-[11px]">
                  {status.advertisedAddress ?? 'Not determined'}
                </span>
                {status.relayId ? (
                  <span className="block mt-1 text-[10px] text-mesh-green">Registered on signaling · heartbeating</span>
                ) : (
                  <span className="block mt-1 text-[10px] text-mesh-text-muted">Not registered — peers must add it manually</span>
                )}
              </div>
            </div>
            {status.error && (
              <div className="mt-3 rounded-lg bg-mesh-danger/10 border border-mesh-danger/40 p-3">
                <span className="text-xs text-mesh-danger font-mono">{status.error}</span>
              </div>
            )}
          </div>
        )}

        {!isContributing && (
          <div className="mt-3 pt-3 border-t border-mesh-border/30 flex items-center gap-3">
            <span className="text-xs text-mesh-text-muted">Scope:</span>
            <select
              value={relayScope}
              onChange={(e) => setRelayScope(e.target.value as 'isp-local' | 'global')}
              className="h-8 px-2 rounded bg-mesh-bg-tertiary border border-mesh-border text-xs text-mesh-text-primary focus:outline-none focus:ring-2 focus:ring-mesh-green"
            >
              <option value="isp-local">Nearby</option>
              <option value="global">Global</option>
            </select>
          </div>
        )}
      </div>
    </div>
  )
}

export { RelaySettings }
