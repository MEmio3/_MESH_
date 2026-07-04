import { useEffect, useState } from 'react'
import { Wifi, Globe, Shield, Copy, Check, Server } from 'lucide-react'
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

  return (
    <div className="max-w-2xl mx-auto py-6 px-6">
      <h2 className="text-lg font-bold text-mesh-text-primary mb-6">Connection</h2>

      {/* Connection Status */}
      <div className="rounded-xl bg-mesh-bg-secondary border border-mesh-border p-5 mb-6">
        <h3 className="text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-3">
          Connection Status
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-mesh-bg-tertiary p-3 text-center">
            <span className="text-xs text-mesh-text-muted block mb-1">Signaling</span>
            {reconnectState?.state === 'reconnecting' ? (
              <span className="text-sm font-semibold flex items-center justify-center gap-1 text-amber-500">
                Reconnecting... (attempt {reconnectState.attempt}{reconnectState.max ? `/${reconnectState.max}` : ''})
              </span>
            ) : reconnectState?.state === 'failed' ? (
              <div className="flex flex-col items-center gap-1 mt-1">
                <span className="text-[11px] font-semibold text-red-400">
                  Could not reconnect. Check your network or relay.
                </span>
                <Button size="sm" onClick={() => reconnectSignaling(network.signalingUrl)} className="mt-1 bg-red-500 hover:bg-red-600 text-white h-7 text-xs">
                  Retry
                </Button>
              </div>
            ) : (
              <span
                className={cn(
                  'text-sm font-semibold flex items-center justify-center gap-1',
                  isConnected ? 'text-mesh-green' : 'text-mesh-text-muted'
                )}
              >
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    isConnected ? 'bg-mesh-green animate-pulse' : 'bg-mesh-text-muted'
                  )}
                />
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            )}
          </div>
          <div className="rounded-lg bg-mesh-bg-tertiary p-3 text-center">
            <span className="text-xs text-mesh-text-muted block mb-1">Relays</span>
            <span className="text-sm text-mesh-text-primary font-semibold">
              {relayCount} registered
            </span>
          </div>
        </div>
      </div>

      {/* Host Signaling Server */}
      <div className="rounded-xl bg-mesh-bg-secondary border border-mesh-border p-5 mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-mesh-text-secondary" />
              <h3 className="text-sm font-semibold text-mesh-text-primary">Host Signaling Server</h3>
            </div>
            <p className="text-xs text-mesh-text-muted mt-1">
              Run the signaling server on this machine so friends can connect through you.
            </p>
          </div>
          <Toggle
            checked={network.hostSignaling}
            onChange={(v) => toggleHost(v)}
          />
        </div>

        {network.hostSignaling ? (
          <div className="mt-4">
            <p className="text-xs text-mesh-text-secondary mb-3">
              Share the address that matches where your friend is:
              same WiFi → Home, same ISP → ISP / Internet, different ISP → Public.
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
                    {items.map((ip) => {
                      const addr = `http://${ip.address}:${hostedPort}`
                      const isCopied = copiedAddr === addr
                      return (
                        <div
                          key={`${ip.iface}-${ip.address}`}
                          className="flex items-center gap-2 rounded-lg bg-mesh-bg-tertiary border border-mesh-border px-3 py-2.5"
                        >
                          <code className="flex-1 text-sm text-mesh-green font-mono truncate">
                            {addr}
                          </code>
                          <span className="text-[10px] text-mesh-text-muted font-mono shrink-0">
                            {ip.iface}
                          </span>
                          <button
                            onClick={() => handleCopyAddress(addr)}
                            className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors"
                            title="Copy address"
                          >
                            {isCopied ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Layer 2 / Layer 3 addresses from the Network Signature Scanner. */}
            <div className="mb-3">
              {!netSig ? (
                <div className="rounded-lg border border-mesh-border bg-mesh-bg-tertiary p-3 flex items-center justify-between">
                  <span className="text-[11px] text-mesh-text-muted">Analyzing network topology...</span>
                </div>
              ) : (
                <>
                  {netSig.signature.routerWanIp && (
                    <div className="mb-3">
                      <p className="text-[11px] font-semibold text-mesh-text-secondary uppercase tracking-wide mb-1.5">
                        ISP / Internet address (from your router)
                      </p>
                      {(() => {
                        const addr = `http://${netSig.signature.routerWanIp}:${hostedPort}`
                        const isCopied = copiedAddr === addr
                        return (
                          <div className="flex items-center gap-2 rounded-lg bg-mesh-bg-tertiary border border-mesh-border px-3 py-2.5">
                            <code className="flex-1 text-sm text-mesh-green font-mono truncate">{addr}</code>
                            <span className="text-[10px] text-mesh-text-muted font-mono shrink-0">upnp</span>
                            <button
                              onClick={() => handleCopyAddress(addr)}
                              className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors"
                              title="Copy address"
                            >
                              {isCopied ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        )
                      })()}
                      <p className="text-[11px] text-mesh-text-muted mt-1">
                        Use this for friends on the same ISP as you.
                      </p>
                    </div>
                  )}
                  {netSig.signature.publicIp && (
                    <div className="mb-3">
                      <p className="text-[11px] font-semibold text-mesh-text-secondary uppercase tracking-wide mb-1.5">
                        Public Internet address
                      </p>
                      {(() => {
                        const addr = `http://${netSig.signature.publicIp}:${hostedPort}`
                        const isCopied = copiedAddr === addr
                        return (
                          <div className="flex items-center gap-2 rounded-lg bg-mesh-bg-tertiary border border-mesh-border px-3 py-2.5">
                            <code className="flex-1 text-sm text-mesh-green font-mono truncate">{addr}</code>
                            <span className="text-[10px] text-mesh-text-muted font-mono shrink-0">ipify</span>
                            <button
                              onClick={() => handleCopyAddress(addr)}
                              className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors"
                              title="Copy address"
                            >
                              {isCopied ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        )
                      })()}
                      <p className="text-[11px] text-mesh-text-muted mt-1">
                        Use this for friends on a different ISP — requires port {hostedPort} forwarded on your router.
                      </p>
                    </div>
                  )}
                  <div className={cn(
                    'rounded-lg border p-2.5 text-[11px]',
                    netSig.interpretation.behindCgnat
                      ? 'border-yellow-500/40 bg-yellow-500/5 text-yellow-200'
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

            {hostStatus.localIps.length === 0 && (
              <p className="text-[11px] text-mesh-text-muted">
                No network interfaces detected. Friends on the same machine can still use
                <code className="mx-1 text-mesh-green">http://localhost:{hostedPort}</code>.
              </p>
            )}

            {hostStatus.error && (
              <p className="text-[11px] text-red-400 mt-2">{hostStatus.error}</p>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-xs text-mesh-text-secondary mb-2">
              Signaling server address (paste the address a friend shared with you):
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="http://203.0.113.4:3000"
                className="flex-1 h-9 px-3 rounded-lg bg-mesh-bg-tertiary border border-mesh-border text-sm text-mesh-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-mesh-green"
              />
              <Button size="sm" onClick={handleSaveUrl} disabled={saving || urlDraft.trim() === network.signalingUrl}>
                {saved ? 'Saved' : saving ? 'Saving…' : 'Connect'}
              </Button>
            </div>
            <p className="text-[11px] text-mesh-text-muted mt-2">
              Saved automatically and reused on next launch.
            </p>
          </div>
        )}
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
                  'flex items-start gap-3 px-4 py-3.5 rounded-lg border text-left transition-colors',
                  isActive
                    ? 'bg-mesh-green/10 border-mesh-green'
                    : 'bg-mesh-bg-tertiary border-mesh-border hover:border-mesh-border-light'
                )}
              >
                <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', isActive ? 'text-mesh-green' : 'text-mesh-text-muted')} />
                <div>
                  <span className={cn('text-sm font-medium block', isActive ? 'text-mesh-green' : 'text-mesh-text-primary')}>
                    {strat.label}
                  </span>
                  <span className="text-xs text-mesh-text-muted">{strat.description}</span>
                </div>
                {isActive && (
                  <div className="ml-auto mt-1 h-4 w-4 rounded-full bg-mesh-green flex items-center justify-center shrink-0">
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export { NetworkSettings }
