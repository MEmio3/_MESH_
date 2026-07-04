import { useEffect, useState } from 'react'
import { Wifi, Globe, Shield, Copy, Check, Server, ChevronRight, Link2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings.store'
import { useIdentityStore } from '@/stores/identity.store'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const strategies = [
  {
    value: 'p2p-first' as const,
    label: 'P2P First',
    description: 'Try direct connection first, fall back to relay only when needed',
    icon: Wifi
  },
  {
    value: 'relay-fallback' as const,
    label: 'Relay Fallback',
    description: 'Use relay signaling but prefer direct media when possible',
    icon: Globe
  },
  {
    value: 'relay-only' as const,
    label: 'Relay Only',
    description: 'Route all traffic through relays for maximum privacy',
    icon: Shield
  }
]

function NetworkSettings(): JSX.Element {
  const network = useSettingsStore((s) => s.network)
  const updateNetwork = useSettingsStore((s) => s.updateNetwork)

  const [isConnected, setIsConnected] = useState(false)
  const [reconnectState, setReconnectState] = useState<{ state: 'reconnecting' | 'connected' | 'failed'; attempt?: number; max?: number | null } | null>(null)
  const [relayCount, setRelayCount] = useState(0)
  type IpScope = 'home' | 'isp' | 'public'
  interface DetectedIp { address: string; scope: IpScope; label: string; iface: string }
  const [hostStatus, setHostStatus] = useState<{
    running: boolean
    port: number
    localIps: DetectedIp[]
    error: string | null
  }>({ running: false, port: 0, localIps: [], error: null })
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null)
  const [netSig, setNetSig] = useState<{
    signature: { localIp: string | null; routerWanIp: string | null; publicIp: string | null; upnpEnabled: boolean }
    interpretation: { behindCgnat: boolean; directlyReachable: boolean; explanation: string }
  } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [urlDraft, setUrlDraft] = useState(network.signalingUrl)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Keep draft in sync if the store changes externally.
  useEffect(() => {
    setUrlDraft(network.signalingUrl)
  }, [network.signalingUrl])

  useEffect(() => {
    let cancelled = false

    const refresh = async (): Promise<void> => {
      const signalingUrl = useSettingsStore.getState().network.signalingUrl || 'http://localhost:3000'
      const [connected, relays, host, remote] = await Promise.all([
        window.api.signaling.isConnected(),
        window.api.db.relays.list(),
        window.api.signalingHost.status(),
        window.api.relay.fetchRemote({ signalingUrl }).catch(() => [])
      ])
      if (cancelled) return
      setIsConnected(connected)
      // Count unique relay addresses across the live signaling registry and
      // the local DB — the old local-only count showed 0 even when peers had
      // working relays registered.
      const unique = new Set<string>()
      for (const r of relays) unique.add(r.address.replace(/^(turns?:|stun:)/, ''))
      for (const r of remote) unique.add(r.address.replace(/^(turns?:|stun:)/, ''))
      setRelayCount(unique.size)
      setHostStatus(host)
    }

    refresh()
    // Load cached network signature; falls back to live scan if not yet ready.
    window.api.network.cached().then((sig) => {
      if (cancelled) return
      if (sig) setNetSig(sig)
      else window.api.network.scan().then((s) => { if (!cancelled) setNetSig(s) }).catch(() => {})
    }).catch(() => {})
    const cleanupConnected = window.api.signaling.onConnected(() => {
      setIsConnected(true)
      setReconnectState({ state: 'connected' })
    })
    const cleanupDisconnected = window.api.signaling.onDisconnected(() => setIsConnected(false))
    const cleanupReconnect = window.api.signaling.onReconnectStatus((st) => setReconnectState(st))
    const interval = setInterval(refresh, 5000)

    return () => {
      cancelled = true
      cleanupConnected()
      cleanupDisconnected()
      cleanupReconnect()
      clearInterval(interval)
    }
  }, [])

  /** Reconnect the signaling socket to whatever URL is currently saved. */
  const reconnectSignaling = async (url: string): Promise<void> => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    try {
      await window.api.signaling.disconnect()
    } catch { /* ignore */ }
    try {
      await window.api.signaling.connect(url, identity.userId)
    } catch (err) {
      console.warn('reconnect failed', err)
    }
  }

  const toggleHost = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const res = await window.api.signalingHost.start({ port: 3000 })
      if (!res.success) {
        setHostStatus((s) => ({ ...s, error: res.error || 'Failed to start' }))
        return
      }
      const url = 'http://localhost:3000'
      updateNetwork({ hostSignaling: true, signalingUrl: url })
      setUrlDraft(url)
      await reconnectSignaling(url)
    } else {
      await window.api.signalingHost.stop()
      updateNetwork({ hostSignaling: false })
    }
    setHostStatus(await window.api.signalingHost.status())
  }

  const handleRescan = async (): Promise<void> => {
    setScanning(true)
    try {
      const sig = await window.api.network.scan()
      setNetSig(sig)
    } catch { /* ignore */ }
    setScanning(false)
  }

  const handleCopyAddress = (addr: string): void => {
    navigator.clipboard.writeText(addr)
    setCopiedAddr(addr)
    setTimeout(() => setCopiedAddr(null), 1500)
  }

  const handleSaveUrl = async (): Promise<void> => {
    const url = urlDraft.trim()
    if (!url) return
    setSaving(true)
    updateNetwork({ signalingUrl: url })
    await reconnectSignaling(url)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const hostedPort = hostStatus.port || 3000
  // Bucket detected IPs by scope so we can render each group separately.
  const grouped: Record<IpScope, DetectedIp[]> = { home: [], isp: [], public: [] }
  for (const ip of hostStatus.localIps) grouped[ip.scope].push(ip)
  const scopeOrder: IpScope[] = ['home', 'isp', 'public']

  // The one address that works for the overwhelmingly common case: a friend
  // on the same Wi-Fi / LAN. Everything else lives under Advanced.
  const primaryIp = grouped.home[0] ?? hostStatus.localIps[0] ?? null
  const primaryAddr = primaryIp ? `http://${primaryIp.address}:${hostedPort}` : null

  const CopyRow = ({ addr, tag }: { addr: string; tag?: string }): JSX.Element => (
    <div className="flex items-center gap-2 rounded-lg bg-mesh-bg-tertiary border border-mesh-border px-3 py-2.5">
      <code className="flex-1 text-sm text-mesh-green font-mono truncate">{addr}</code>
      {tag && <span className="text-[10px] text-mesh-text-muted font-mono shrink-0">{tag}</span>}
      <button
        onClick={() => handleCopyAddress(addr)}
        className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors"
        title="Copy address"
      >
        {copiedAddr === addr ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto py-6 px-6">
      <h2 className="text-lg font-bold text-mesh-text-primary mb-1">Connection</h2>
      <p className="text-xs text-mesh-text-muted mb-6">
        One person hosts, everyone else joins with their address. That&apos;s it.
      </p>

      {/* Status strip — one line, no jargon */}
      <div className="flex items-center gap-2.5 rounded-lg bg-mesh-bg-secondary border border-mesh-border px-4 py-3 mb-4">
        <div className={cn('h-2 w-2 rounded-full shrink-0', isConnected ? 'bg-mesh-green' : reconnectState?.state === 'reconnecting' ? 'bg-mesh-warning animate-pulse' : 'bg-mesh-text-muted')} />
        <span className="text-sm text-mesh-text-primary flex-1 min-w-0 truncate">
          {reconnectState?.state === 'reconnecting'
            ? `Reconnecting… (attempt ${reconnectState.attempt ?? 1})`
            : isConnected
              ? network.hostSignaling ? 'Connected — you are the host' : 'Connected'
              : 'Not connected'}
        </span>
        {!isConnected && reconnectState?.state !== 'reconnecting' && (
          <Button size="sm" variant="secondary" onClick={() => reconnectSignaling(network.signalingUrl)}>
            Retry
          </Button>
        )}
      </div>

      {/* Card: Host for your friends */}
      <div className="rounded-xl bg-mesh-bg-secondary border border-mesh-border p-5 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-mesh-text-secondary" />
              <h3 className="text-sm font-semibold text-mesh-text-primary">Host for your friends</h3>
            </div>
            <p className="text-xs text-mesh-text-muted mt-1">
              Turn this on, share your address, and friends connect through you.
            </p>
          </div>
          <Toggle checked={network.hostSignaling} onChange={(v) => toggleHost(v)} />
        </div>

        {network.hostSignaling && (
          <div className="mt-4">
            {primaryAddr ? (
              <>
                <p className="text-[11px] font-semibold text-mesh-text-secondary uppercase tracking-wide mb-1.5">
                  Share this address
                </p>
                <CopyRow addr={primaryAddr} />
                <p className="text-[11px] text-mesh-text-muted mt-2">
                  Works for friends on the same Wi-Fi or network as you. Friend somewhere
                  else? Open <span className="text-mesh-text-secondary">Advanced</span> below for more addresses.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-mesh-text-muted">
                No network detected. Friends on this machine can still use
                <code className="mx-1 text-mesh-green">http://localhost:{hostedPort}</code>.
              </p>
            )}
            {hostStatus.error && (
              <p className="text-[11px] text-mesh-danger mt-2">{hostStatus.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Card: Join a friend (hidden while hosting — your address is set automatically) */}
      {!network.hostSignaling && (
        <div className="rounded-xl bg-mesh-bg-secondary border border-mesh-border p-5 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="h-4 w-4 text-mesh-text-secondary" />
            <h3 className="text-sm font-semibold text-mesh-text-primary">Join a friend</h3>
          </div>
          <p className="text-xs text-mesh-text-muted mb-3">
            Paste the address your friend shared, then hit Connect.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="http://192.168.1.20:3000"
              className="flex-1 h-9 px-3 rounded-lg bg-mesh-bg-tertiary border border-mesh-border text-sm text-mesh-text-primary font-mono focus:outline-none focus:border-mesh-green focus:ring-1 focus:ring-mesh-green/30"
            />
            <Button size="sm" onClick={handleSaveUrl} disabled={saving || urlDraft.trim() === network.signalingUrl}>
              {saved ? 'Saved' : saving ? 'Saving…' : 'Connect'}
            </Button>
          </div>
          <p className="text-[11px] text-mesh-text-muted mt-2">
            Remembered for next launch — you only do this once.
          </p>
        </div>
      )}

      {/* Advanced — everything network-nerdy lives behind this */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-mesh-text-secondary hover:text-mesh-text-primary transition-colors mb-4"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-90')} />
        Advanced
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-4">
          {/* All host addresses by scope */}
          {network.hostSignaling && (
            <div className="rounded-xl bg-mesh-bg-secondary border border-mesh-border p-5">
              <h3 className="text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-3">
                All your addresses
              </h3>
              <p className="text-xs text-mesh-text-muted mb-3">
                Pick by where your friend is: same Wi-Fi → Home, same internet provider → ISP,
                anywhere else → Public.
              </p>
              {scopeOrder.map((scope) => {
                const items = grouped[scope]
                if (items.length === 0) return null
                return (
                  <div key={scope} className="mb-3 last:mb-0">
                    <p className="text-[11px] font-semibold text-mesh-text-secondary uppercase tracking-wide mb-1.5">
                      {items[0].label}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {items.map((ip) => (
                        <CopyRow key={`${ip.iface}-${ip.address}`} addr={`http://${ip.address}:${hostedPort}`} tag={ip.iface} />
                      ))}
                    </div>
                  </div>
                )
              })}
              {!netSig ? (
                <p className="text-[11px] text-mesh-text-muted">Analyzing network topology…</p>
              ) : (
                <>
                  {netSig.signature.routerWanIp && (
                    <div className="mb-3">
                      <p className="text-[11px] font-semibold text-mesh-text-secondary uppercase tracking-wide mb-1.5">
                        ISP address (from your router)
                      </p>
                      <CopyRow addr={`http://${netSig.signature.routerWanIp}:${hostedPort}`} tag="upnp" />
                      <p className="text-[11px] text-mesh-text-muted mt-1">For friends on the same internet provider.</p>
                    </div>
                  )}
                  {netSig.signature.publicIp && (
                    <div className="mb-3">
                      <p className="text-[11px] font-semibold text-mesh-text-secondary uppercase tracking-wide mb-1.5">
                        Public internet address
                      </p>
                      <CopyRow addr={`http://${netSig.signature.publicIp}:${hostedPort}`} tag="ipify" />
                      <p className="text-[11px] text-mesh-text-muted mt-1">
                        For friends anywhere — needs port {hostedPort} forwarded on your router.
                      </p>
                    </div>
                  )}
                  <div className={cn(
                    'rounded-lg border p-2.5 text-[11px]',
                    netSig.interpretation.behindCgnat
                      ? 'border-mesh-warning/40 bg-mesh-warning/5 text-mesh-warning'
                      : netSig.interpretation.directlyReachable
                      ? 'border-mesh-green/40 bg-mesh-green/5 text-mesh-text-secondary'
                      : 'border-mesh-border bg-mesh-bg-tertiary text-mesh-text-muted'
                  )}>
                    {netSig.interpretation.explanation}
                  </div>
                  <button
                    onClick={handleRescan}
                    disabled={scanning}
                    className="mt-2 text-[11px] text-mesh-text-muted hover:text-mesh-text-primary transition-colors disabled:opacity-50"
                  >
                    {scanning ? 'Scanning…' : 'Re-scan network'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Relays */}
          <div className="rounded-xl bg-mesh-bg-secondary border border-mesh-border px-5 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide">Relays</h3>
              <p className="text-[11px] text-mesh-text-muted mt-0.5">Fallback servers used when a direct connection fails.</p>
            </div>
            <span className="text-sm text-mesh-text-primary font-semibold">{relayCount} available</span>
          </div>

          {/* ICE Strategy */}
          <div>
            <h3 className="text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-3">
              Connection Strategy
            </h3>
            <div className="flex flex-col gap-2">
              {strategies.map((strat) => {
                const isActive = network.preferredIceStrategy === strat.value
                const Icon = strat.icon
                return (
                  <button
                    key={strat.value}
                    onClick={() => updateNetwork({ preferredIceStrategy: strat.value })}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 rounded-lg border text-left transition-colors',
                      isActive
                        ? 'bg-mesh-green/10 border-mesh-green/60'
                        : 'bg-mesh-bg-tertiary border-mesh-border hover:border-mesh-border-light'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', isActive ? 'text-mesh-green' : 'text-mesh-text-muted')} />
                    <div>
                      <span className={cn('text-sm font-medium block', isActive ? 'text-mesh-green' : 'text-mesh-text-primary')}>
                        {strat.label}
                      </span>
                      <span className="text-xs text-mesh-text-muted">{strat.description}</span>
                    </div>
                    {isActive && (
                      <div className="ml-auto mt-1 h-3.5 w-3.5 rounded-full bg-mesh-green flex items-center justify-center shrink-0">
                        <div className="h-1 w-1 rounded-full bg-white" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { NetworkSettings }
