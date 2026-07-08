import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ChevronRight, Copy, Loader2, PlugZap, Radio, RefreshCw, Router, Server, Shield, Trash2, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { cn } from '@/lib/utils'
import { useIdentityStore } from '@/stores/identity.store'
import { useSettingsStore, type KnownNetwork, type ServerHostAssignment } from '@/stores/settings.store'
import { useServersStore } from '@/stores/servers.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'
import { encodeConnectionCode, resolveConnectionInput } from '@/lib/connection-code'

type IpScope = 'home' | 'isp' | 'public'

interface DetectedIp {
  address: string
  scope: IpScope
  label: string
  iface: string
}

interface HostStatus {
  running: boolean
  port: number
  ports?: number[]
  localIps: DetectedIp[]
  error: string | null
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

interface RemoteRelay {
  id: string
  address: string
  scope: 'isp-local' | 'global'
  credentials: { username: string; password: string } | null
  users: number
}

interface ProbeRow {
  success: boolean
  url: string
  latencyMs: number | null
  serverCount: number
  error?: string
  loading?: boolean
}

interface NetworkScanResult {
  signature: {
    localIp: string | null
    routerWanIp: string | null
    publicIp: string | null
    upnpEnabled: boolean
  }
  interpretation: {
    behindCgnat: boolean
    directlyReachable: boolean
    explanation: string
  }
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

function isLocalNetworkUrl(url: string): boolean {
  try {
    const hostname = new URL(normalizeNetworkUrl(url)).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

function copyToClipboard(value: string, setCopied: (value: string | null) => void): void {
  navigator.clipboard.writeText(value)
  setCopied(value)
  setTimeout(() => setCopied(null), 1400)
}

function isPrivateOrCgnatIp(ip: string | null): boolean {
  if (!ip) return false
  const [a, b] = ip.split('.').map((n) => parseInt(n, 10))
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function normalizePort(value: string | number | null | undefined): number {
  const raw = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(raw)) return 3000
  return Math.min(65535, Math.max(1, Math.floor(raw)))
}

function NetworkCenterPage(): JSX.Element {
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const network = useSettingsStore((s) => s.network)
  const updateNetwork = useSettingsStore((s) => s.updateNetwork)
  const servers = useServersStore((s) => s.servers)
  const serverAvatars = useServerAvatarStore((s) => s.byServer)
  const savedHostPort = normalizePort(network.hostPort)

  const [isConnected, setIsConnected] = useState(false)
  const [reconnectState, setReconnectState] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle')
  const [hostStatus, setHostStatus] = useState<HostStatus>({ running: false, port: savedHostPort, localIps: [], error: null })
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null)
  const [relayScope, setRelayScope] = useState<'isp-local' | 'global'>('isp-local')
  const [remoteRelays, setRemoteRelays] = useState<RemoteRelay[]>([])
  const [urlDraft, setUrlDraft] = useState(network.signalingUrl || 'http://localhost:3000')
  const [hostPortDraft, setHostPortDraft] = useState(String(savedHostPort))
  const [savedName, setSavedName] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [probes, setProbes] = useState<Record<string, ProbeRow>>({})
  const [netSig, setNetSig] = useState<NetworkScanResult | null>(null)
  const [scanningNetwork, setScanningNetwork] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const activeUrl = normalizeNetworkUrl(network.signalingUrl || 'http://localhost:3000')
  const hostedServers = servers.filter((server) => server.role === 'host')
  const primaryIp = hostStatus.localIps.find((ip) => ip.scope === 'home') ?? hostStatus.localIps[0] ?? null
  const selectedHostPort = normalizePort(hostPortDraft || savedHostPort)
  const hostPort = hostStatus.running ? normalizePort(hostStatus.port || savedHostPort) : selectedHostPort
  const sameWifiAddress = primaryIp ? `http://${primaryIp.address}:${hostPort}` : `http://localhost:${hostPort}`
  const publicAddress = netSig?.signature.publicIp ? `http://${netSig.signature.publicIp}:${hostPort}` : null
  const hostPorts = useMemo(() => {
    return [...new Set([savedHostPort, ...network.extraHostPorts, ...(hostStatus.ports ?? [])].map(normalizePort))]
      .sort((a, b) => a - b)
  }, [savedHostPort, network.extraHostPorts, hostStatus.ports])
  const hostAddressOptions = useMemo(() => {
    const ips = hostStatus.localIps.map((ip) => ({
      value: ip.address,
      label: `${ip.address} - ${ip.scope === 'home' ? 'same Wi-Fi' : ip.scope}`
    }))
    return [{ value: 'localhost', label: 'localhost - this computer' }, ...ips]
  }, [hostStatus.localIps])
  const relayAddress = relayStatus?.advertisedAddress ?? (relayStatus?.running ? `turn:localhost:${relayStatus.port}` : null)
  const canSharePublic = Boolean(publicAddress && netSig && !netSig.interpretation.behindCgnat)
  const sharePlan = (() => {
    if (!hostStatus.running) {
      return {
        title: 'Hosting is off',
        address: null as string | null,
        button: 'Turn on hosting',
        note: 'Turn hosting on before sharing anything.',
        tone: 'offline' as const
      }
    }
    if (canSharePublic) {
      return {
        title: netSig?.interpretation.directlyReachable ? 'Internet invite' : 'Internet invite',
        address: publicAddress,
        button: 'Copy internet invite',
        note: `Use this for friends outside your Wi-Fi. Port ${hostPort} must be open on your router.`,
        tone: 'online' as const
      }
    }
    if (netSig?.interpretation.behindCgnat) {
      return {
        title: 'Same Wi-Fi only',
        address: sameWifiAddress,
        button: 'Copy same-Wi-Fi invite',
        note: 'Your ISP is using private/CGNAT networking. Friends outside your Wi-Fi need a relay, VPN, or a host with a real public IP.',
        tone: 'blocked' as const
      }
    }
    return {
      title: 'Same Wi-Fi invite',
      address: sameWifiAddress,
      button: 'Copy same-Wi-Fi invite',
      note: netSig ? 'No reachable public address was found. Use this only with people on your router/LAN.' : 'Checking public reachability. This address works only on the same router/LAN.',
      tone: 'busy' as const
    }
  })()
  // Share the obfuscated code, not the bare IP — the raw address stays tucked
  // away under "Connection details" for anyone who needs it.
  const shareCode = sharePlan.address ? encodeConnectionCode(sharePlan.address) : null

  const knownNetworks = useMemo(() => {
    const seen = new Set<string>([activeUrl.toLowerCase()])
    return network.knownNetworks
      .map((n) => ({ ...n, url: normalizeNetworkUrl(n.url) }))
      .filter((n) => {
        if (!n.url) return false
        const key = n.url.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [activeUrl, network.knownNetworks])

  async function refreshStatus(): Promise<void> {
    const [connected, host, relay, remote] = await Promise.all([
      window.api.signaling.isConnected().catch(() => false),
      window.api.signalingHost.status(),
      window.api.relay.status(),
      window.api.relay.fetchRemote({ signalingUrl: activeUrl }).catch(() => [])
    ])
    setIsConnected(connected)
    setHostStatus(host)
    setRelayStatus(relay)
    setRemoteRelays(remote)
    setRelayScope(relay.scope ?? 'isp-local')
  }

  async function refreshNetworkScan(): Promise<void> {
    setScanningNetwork(true)
    try {
      const scan = await window.api.network.scan()
      setNetSig(scan)
    } catch {
      setNetSig(null)
    } finally {
      setScanningNetwork(false)
    }
  }

  useEffect(() => {
    setUrlDraft(activeUrl)
  }, [activeUrl])

  useEffect(() => {
    if (!hostStatus.running) setHostPortDraft(String(savedHostPort))
  }, [savedHostPort, hostStatus.running])

  useEffect(() => {
    let cancelled = false
    const refresh = async (): Promise<void> => {
      await refreshStatus()
      if (cancelled) return
    }
    void refresh()
    const offConnected = window.api.signaling.onConnected(() => {
      setIsConnected(true)
      setReconnectState('connected')
    })
    const offDisconnected = window.api.signaling.onDisconnected(() => {
      setIsConnected(false)
      setReconnectState('failed')
    })
    const offReconnect = window.api.signaling.onReconnectStatus((status) => {
      setReconnectState(status.state === 'reconnecting' ? 'connecting' : status.state)
    })
    const interval = setInterval(refresh, 5000)
    window.api.network.cached().then((cached) => {
      if (cancelled) return
      if (cached) setNetSig(cached)
      else void refreshNetworkScan()
    }).catch(() => {})
    return () => {
      cancelled = true
      offConnected()
      offDisconnected()
      offReconnect()
      clearInterval(interval)
    }
  }, [activeUrl])

  async function reregisterHostedServers(): Promise<void> {
    if (!identity) return
    await window.api.server.reregisterMine({
      selfUserId: identity.userId,
      selfUsername: identity.username,
      selfAvatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null
    })
  }

  async function connectTo(urlInput: string, keepHostMode = false): Promise<void> {
    if (!identity) {
      setNotice('Create your profile first, then connect.')
      return
    }
    // Accept a MESH connection code OR a raw IP:port/URL. A code decodes back
    // to its address; anything else is treated as a normal URL.
    const url = normalizeNetworkUrl(resolveConnectionInput(urlInput))
    if (!url) {
      setNotice('Enter a MESH code or IP:port.')
      return
    }
    setReconnectState('connecting')
    setNotice(null)
    const wasHosting = hostStatus.running || network.hostSignaling
    try {
      updateNetwork(keepHostMode ? { signalingUrl: url, hostSignaling: true } : { signalingUrl: url })
      await window.api.signaling.disconnect().catch(() => {})
      await window.api.signaling.connect(url, identity.userId)
      if (wasHosting) await reregisterHostedServers()
      setIsConnected(true)
      setReconnectState('connected')
      setNotice(wasHosting && !isLocalNetworkUrl(url)
        ? `Connected to ${hostFromUrl(url)}. Your local host is still running.`
        : `Connected to ${hostFromUrl(url)}.`
      )
    } catch (err) {
      setReconnectState('failed')
      setNotice(err instanceof Error ? err.message : 'Could not connect.')
    }
  }

  async function toggleHost(enabled: boolean): Promise<void> {
    if (enabled) {
      const port = normalizePort(hostPortDraft || savedHostPort)
      setHostPortDraft(String(port))
      const res = await window.api.signalingHost.start({ port })
      if (!res.success) {
        setNotice(res.error ?? 'Could not start hosting.')
        setHostStatus(await window.api.signalingHost.status())
        return
      }
      const localUrl = `http://localhost:${port}`
      const keepActiveRemote = isConnected && !isLocalNetworkUrl(activeUrl)
      updateNetwork({ hostSignaling: true, hostPort: port, signalingUrl: keepActiveRemote ? activeUrl : localUrl })
      setHostStatus((s) => ({ ...s, running: true, port, error: null }))
      if (keepActiveRemote) {
        await reregisterHostedServers()
        setNotice(`Hosting on port ${port}; still connected to ${hostFromUrl(activeUrl)}.`)
      } else {
        await connectTo(localUrl, true)
      }
    } else {
      await window.api.signalingHost.stop()
      setHostStatus((s) => ({ ...s, running: false, error: null }))
      updateNetwork({ hostSignaling: false })
    }
    await refreshStatus()
  }

  async function applyHostPort(): Promise<void> {
    const port = normalizePort(hostPortDraft)
    setHostPortDraft(String(port))
    updateNetwork({ hostPort: port })
    if (!hostStatus.running) {
      setNotice(`Host port saved as ${port}.`)
      return
    }
    const res = await window.api.signalingHost.start({ port })
    if (!res.success) {
      setNotice(res.error ?? `Could not switch host to port ${port}.`)
      await refreshStatus()
      return
    }
    const localUrl = `http://localhost:${port}`
    const keepActiveRemote = isConnected && !isLocalNetworkUrl(activeUrl)
    updateNetwork({ hostSignaling: true, hostPort: port, signalingUrl: keepActiveRemote ? activeUrl : localUrl })
    setHostStatus((s) => ({ ...s, running: true, port, error: null }))
    if (keepActiveRemote) {
      await reregisterHostedServers()
    } else {
      await connectTo(localUrl, true)
    }
    await refreshStatus()
    setNotice(`Hosting moved to port ${port}.`)
  }

  // ── Multi-hosting: independent host instances on additional ports ──
  const [extraPortDraft, setExtraPortDraft] = useState('')

  async function addExtraHost(): Promise<void> {
    const port = normalizePort(extraPortDraft)
    const primary = normalizePort(hostStatus.running ? hostStatus.port : savedHostPort)
    if (port === primary || network.extraHostPorts.includes(port)) {
      setNotice(`Port ${port} is already hosting.`)
      return
    }
    const res = await window.api.signalingHost.start({ port })
    if (!res.success) {
      setNotice(res.error ?? `Could not start a host on port ${port}.`)
      return
    }
    updateNetwork({ extraHostPorts: [...network.extraHostPorts, port].sort((a, b) => a - b) })
    setExtraPortDraft('')
    await refreshStatus()
    setNotice(`Now also hosting on port ${port}.`)
  }

  async function removeExtraHost(port: number): Promise<void> {
    await window.api.signalingHost.stop({ port })
    const reassigned = Object.fromEntries(
      Object.entries(network.serverHostAssignments).map(([serverId, assignment]) => [
        serverId,
        normalizePort(assignment.port) === port
          ? { ...assignment, port: savedHostPort }
          : assignment
      ])
    )
    updateNetwork({
      extraHostPorts: network.extraHostPorts.filter((p) => p !== port),
      serverHostAssignments: reassigned
    })
    if (identity) {
      await window.api.server.reregisterMine({
        selfUserId: identity.userId,
        selfUsername: identity.username,
        selfAvatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null
      })
    }
    await refreshStatus()
    setNotice(`Stopped hosting on port ${port}.`)
  }

  function defaultServerHostAssignment(serverId: string): ServerHostAssignment {
    const saved = network.serverHostAssignments[serverId]
    const fallbackAddress = primaryIp?.address ?? 'localhost'
    const port = hostPorts.includes(normalizePort(saved?.port)) ? normalizePort(saved?.port) : savedHostPort
    return {
      port,
      address: saved?.address || fallbackAddress
    }
  }

  async function saveServerHostAssignment(serverId: string, partial: Partial<ServerHostAssignment>): Promise<void> {
    const current = defaultServerHostAssignment(serverId)
    const next: ServerHostAssignment = {
      port: normalizePort(partial.port ?? current.port),
      address: String(partial.address ?? current.address).trim() || 'localhost'
    }
    if (!hostPorts.includes(next.port)) return

    if (!(hostStatus.ports ?? []).includes(next.port)) {
      const res = await window.api.signalingHost.start({ port: next.port })
      if (!res.success) {
        setNotice(res.error ?? `Could not start host on port ${next.port}.`)
        return
      }
    }

    if (current.port !== next.port) {
      window.api.signaling.emit('server:unregister', { serverId, port: current.port })
    }

    updateNetwork({
      serverHostAssignments: {
        ...network.serverHostAssignments,
        [serverId]: next
      }
    })
    if (identity) {
      await window.api.server.reregisterMine({
        selfUserId: identity.userId,
        selfUsername: identity.username,
        selfAvatarColor: (identity as unknown as { avatarPath?: string | null }).avatarPath ?? null
      })
    }
    await refreshStatus()
    setNotice(`Updated hosting route for this server to ${next.address}:${next.port}.`)
  }

  async function toggleRelay(enabled: boolean): Promise<void> {
    if (enabled) {
      const res = await window.api.relay.start({ scope: relayScope, signalingUrl: activeUrl })
      if (!res.success) setNotice(res.error ?? 'Could not start relay.')
    } else {
      await window.api.relay.stop()
    }
    await refreshStatus()
  }

  function saveCurrentHost(): void {
    const url = normalizeNetworkUrl(urlDraft)
    if (!url) return
    const duplicate = network.knownNetworks.some((n) => normalizeNetworkUrl(n.url).toLowerCase() === url.toLowerCase())
    if (duplicate || url.toLowerCase() === activeUrl.toLowerCase()) {
      setNotice('That host is already saved or active.')
      return
    }
    const next: KnownNetwork = {
      id: `net_${Date.now().toString(36)}`,
      name: savedName.trim() || hostFromUrl(url),
      url
    }
    updateNetwork({ knownNetworks: [...network.knownNetworks, next] })
    setSavedName('')
    setNotice('Host saved.')
  }

  function removeKnownNetwork(id: string): void {
    updateNetwork({ knownNetworks: network.knownNetworks.filter((n) => n.id !== id) })
  }

  async function scanKnownNetwork(net: KnownNetwork): Promise<void> {
    const key = net.id
    setProbes((s) => ({
      ...s,
      [key]: { success: false, url: normalizeNetworkUrl(net.url), latencyMs: null, serverCount: s[key]?.serverCount ?? 0, loading: true }
    }))
    const result = await window.api.networkDiscovery.fetchServers({ url: net.url })
    setProbes((s) => ({
      ...s,
      [key]: {
        success: result.success,
        url: result.url,
        latencyMs: result.latencyMs,
        serverCount: result.servers.length,
        error: result.error,
        loading: false
      }
    }))
  }

  const connectionLabel = reconnectState === 'connecting'
    ? 'Connecting'
    : isConnected
      ? 'Connected'
      : 'Offline'
  const connectionTone = reconnectState === 'connecting'
    ? 'busy'
    : isConnected
      ? 'online'
      : 'offline'

  return (
    <div className="flex h-full min-h-0 flex-col bg-mesh-bg-primary">
      <div className="shrink-0 border-b border-mesh-border/60 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary text-mesh-green transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-mesh-green/50">
                <Router className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold text-mesh-text-primary">Network Center</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mesh-text-muted">
                  <StatusDot tone={connectionTone} />
                  <span>{connectionLabel}</span>
                  <span className="h-1 w-1 rounded-full bg-mesh-text-muted/60" />
                  <span className="font-mono">{hostFromUrl(activeUrl)}</span>
                </div>
              </div>
            </div>
          </div>
          <Button variant="secondary" onClick={refreshStatus}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {notice && (
          <div className="mb-4 rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary px-4 py-3 text-sm text-mesh-text-secondary">
            {notice}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="space-y-4">
            <section className="rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary/70 p-5">
            <PanelHeader
              icon={<PlugZap className="h-4 w-4" />}
              title="Connect"
              detail={isConnected ? activeUrl : 'No active host'}
              tone={isConnected ? 'online' : reconnectState === 'connecting' ? 'busy' : 'offline'}
            />
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connectTo(urlDraft)}
                placeholder="Paste a MESH-code or 192.168.0.23:3000"
                className="h-9 min-w-0 rounded-md border border-mesh-border bg-mesh-bg-primary px-3 font-mono text-xs text-mesh-text-primary outline-none placeholder:text-mesh-text-muted focus:border-mesh-green/60"
              />
              <Button size="sm" disabled={reconnectState === 'connecting'} onClick={() => connectTo(urlDraft)}>
                {reconnectState === 'connecting' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                Connect
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input
                value={savedName}
                onChange={(e) => setSavedName(e.target.value)}
                placeholder="Name this host"
                className="h-8 min-w-0 rounded-md border border-mesh-border bg-mesh-bg-primary px-3 text-xs text-mesh-text-primary outline-none placeholder:text-mesh-text-muted focus:border-mesh-green/60"
              />
              <Button size="sm" variant="secondary" onClick={saveCurrentHost}>Save</Button>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-muted">Saved Hosts</span>
                <span className="text-[11px] text-mesh-text-muted">{knownNetworks.length}</span>
              </div>
              <div className="space-y-2">
                {knownNetworks.length === 0 ? (
                  <EmptyLine text="Saved friend hosts will appear here." />
                ) : knownNetworks.map((net) => {
                  const probe = probes[net.id]
                  return (
                    <div key={net.id} className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/65 p-3">
                      <div className="flex items-start gap-3">
                        <StatusDot tone={probe?.loading ? 'busy' : probe?.success ? 'online' : 'offline'} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-mesh-text-primary">{net.name}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-mesh-text-muted">{normalizeNetworkUrl(net.url)}</div>
                          <div className="mt-1 text-[11px] text-mesh-text-muted">
                            {probe?.loading
                              ? 'Scanning'
                              : probe?.success
                                ? `${probe.serverCount} live servers${probe.latencyMs != null ? `, ${probe.latencyMs}ms` : ''}`
                                : probe?.error ?? 'Not scanned'}
                          </div>
                        </div>
                        <RowActions
                          onConnect={() => connectTo(net.url)}
                          onScan={() => scanKnownNetwork(net)}
                          onRemove={() => removeKnownNetwork(net.id)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            </section>

            <section className="rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary/70 p-5">
              <PanelHeader
                icon={<Radio className="h-4 w-4" />}
                title="Relay"
                detail={relayStatus?.running ? relayAddress ?? 'Running' : 'Off'}
                tone={relayStatus?.running ? 'online' : 'offline'}
              >
                <Toggle checked={relayStatus?.running ?? false} onChange={toggleRelay} />
              </PanelHeader>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Metric label="Port" value={relayStatus?.running ? String(relayStatus.port) : '-'} />
                <Metric label="Users" value={String(relayStatus?.connections ?? 0)} />
                <Metric label="Remote relays" value={String(remoteRelays.length)} />
                <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3">
                  <div className="mb-1 text-[11px] text-mesh-text-muted">Scope</div>
                  <select
                    value={relayScope}
                    disabled={relayStatus?.running}
                    onChange={(e) => setRelayScope(e.target.value as 'isp-local' | 'global')}
                    className="h-7 w-full rounded border border-mesh-border bg-mesh-bg-tertiary px-2 text-xs text-mesh-text-primary outline-none disabled:opacity-70"
                  >
                    <option value="isp-local">Nearby</option>
                    <option value="global">Global</option>
                  </select>
                </div>
              </div>
              {relayAddress && (
                <div className="mt-2">
                  <CopyRow label="Relay address" value={relayAddress} copied={copied} onCopy={setCopied} />
                </div>
              )}
              {relayStatus?.credentials && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <CopyRow label="Username" value={relayStatus.credentials.username} copied={copied} onCopy={setCopied} />
                  <CopyRow label="Password" value={relayStatus.credentials.password} copied={copied} onCopy={setCopied} />
                </div>
              )}
              {relayStatus?.error && <div className="mt-2 text-xs text-mesh-danger">{relayStatus.error}</div>}
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary/70 p-5">
            <PanelHeader
              icon={<Server className="h-4 w-4" />}
              title="Host"
              detail={sharePlan.title}
              tone={hostStatus.running ? sharePlan.tone === 'blocked' ? 'busy' : 'online' : 'offline'}
            >
              <Toggle checked={network.hostSignaling || hostStatus.running} onChange={toggleHost} />
            </PanelHeader>

            <div className="mt-4 space-y-2">
              <div className={cn(
                'rounded-lg border p-4',
                sharePlan.tone === 'blocked'
                  ? 'border-mesh-warning/45 bg-mesh-warning/5'
                  : sharePlan.tone === 'online'
                    ? 'border-mesh-green/40 bg-mesh-green/5'
                    : 'border-mesh-border/70 bg-mesh-bg-primary/70'
              )}>
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border',
                    sharePlan.tone === 'blocked'
                      ? 'border-mesh-warning/40 text-mesh-warning'
                      : 'border-mesh-border/60 text-mesh-green'
                  )}>
                    {sharePlan.tone === 'blocked' ? <AlertTriangle className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-mesh-text-primary">{sharePlan.title}</div>
                    {shareCode && (
                      <div className="mt-1 break-all font-mono text-sm text-mesh-green">{shareCode}</div>
                    )}
                    <p className="mt-1 text-xs leading-relaxed text-mesh-text-muted">
                      {sharePlan.note} Share this code — your IP stays hidden.
                    </p>
                  </div>
                </div>
                {shareCode ? (
                  <Button
                    className="mt-3 w-full"
                    variant={sharePlan.tone === 'blocked' ? 'secondary' : 'primary'}
                    onClick={() => copyToClipboard(shareCode, setCopied)}
                  >
                    {copied === shareCode ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    {copied === shareCode ? 'Copied' : 'Copy invite code'}
                  </Button>
                ) : (
                  <Button className="mt-3 w-full" onClick={() => toggleHost(true)}>
                    Turn on hosting
                  </Button>
                )}
              </div>
              <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-muted">Host port</div>
                    <div className="mt-0.5 text-[11px] text-mesh-text-muted">All hosted MESH servers share this port.</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      value={hostPortDraft}
                      onChange={(e) => setHostPortDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                      onBlur={() => setHostPortDraft(String(normalizePort(hostPortDraft)))}
                      className="h-8 w-20 rounded-md border border-mesh-border bg-mesh-bg-tertiary px-2 text-right font-mono text-xs text-mesh-text-primary outline-none focus:border-mesh-green/60"
                      inputMode="numeric"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={normalizePort(hostPortDraft) === normalizePort(hostStatus.running ? hostStatus.port : savedHostPort)}
                      onClick={applyHostPort}
                    >
                      {hostStatus.running ? 'Restart' : 'Save'}
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-mesh-text-muted">
                  Your primary port. Every community you host is reachable here.
                  You also connect through it.
                </p>
              </div>

              {/* Multi-hosting — run separate, isolated MESH networks on extra
                  ports at the same time (e.g. a private group on 3100 while
                  your main community stays on 3000). */}
              {hostStatus.running && (
                <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-muted">
                        Additional host ports
                      </div>
                      <div className="mt-0.5 text-[11px] text-mesh-text-muted">
                        Separate, isolated networks running alongside your primary.
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        value={extraPortDraft}
                        onChange={(e) => setExtraPortDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                        placeholder="3100"
                        inputMode="numeric"
                        className="h-8 w-20 rounded-md border border-mesh-border bg-mesh-bg-tertiary px-2 text-right font-mono text-xs text-mesh-text-primary outline-none placeholder:text-mesh-text-muted focus:border-mesh-green/60"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!extraPortDraft || normalizePort(extraPortDraft) === hostPort}
                        onClick={addExtraHost}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                  {network.extraHostPorts.length === 0 ? (
                    <EmptyLine text="No extra ports. Add one to host a second, separate network." />
                  ) : (
                    <div className="space-y-1.5">
                      {network.extraHostPorts.map((p) => {
                        const live = (hostStatus.ports ?? []).includes(p)
                        return (
                          <div key={p} className="flex items-center gap-2.5 rounded-md border border-mesh-border/60 bg-mesh-bg-tertiary/50 px-3 py-1.5">
                            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', live ? 'bg-mesh-green' : 'bg-mesh-danger')} />
                            <span className="font-mono text-xs text-mesh-text-primary">:{p}</span>
                            <span className="text-[11px] text-mesh-text-muted">{live ? 'running' : 'stopped'}</span>
                            <button
                              onClick={() => removeExtraHost(p)}
                              className="ml-auto text-[11px] text-mesh-danger/80 transition-colors hover:text-mesh-danger"
                            >
                              Stop
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Port" value={String(hostPort)} />
                <Metric label="Reachability" value={sharePlan.tone === 'online' ? 'Internet' : sharePlan.tone === 'blocked' ? 'LAN only' : 'Checking'} />
              </div>
              <button
                onClick={() => setShowDiagnostics((v) => !v)}
                className="flex items-center gap-1.5 pt-1 text-xs font-medium text-mesh-text-muted transition-colors hover:text-mesh-text-primary"
              >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showDiagnostics && 'rotate-90')} />
                Connection details
              </button>
              {showDiagnostics && (
                <div className="space-y-1.5 rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/50 p-3">
                  {/* Every shareable address gets its own MESH code — you'll
                      send the internet one to friends outside your Wi-Fi, so it
                      must be obfuscated too, not just the same-Wi-Fi one. */}
                  <ShareCodeRow label="Same Wi-Fi only" address={sameWifiAddress} tag={primaryIp?.iface} copied={copied} onCopy={setCopied} />
                  {netSig?.signature.routerWanIp && (
                    <ShareCodeRow
                      label={isPrivateOrCgnatIp(netSig.signature.routerWanIp) ? 'Router/ISP private address' : 'Router public address'}
                      address={`http://${netSig.signature.routerWanIp}:${hostPort}`}
                      muted={isPrivateOrCgnatIp(netSig.signature.routerWanIp)}
                      note={isPrivateOrCgnatIp(netSig.signature.routerWanIp) ? 'Behind ISP NAT — usually only reachable if the router forwards this port.' : `Useful only if port ${hostPort} is open.`}
                      copied={copied}
                      onCopy={setCopied}
                    />
                  )}
                  {publicAddress && (
                    <ShareCodeRow
                      label={netSig?.interpretation.behindCgnat ? 'Website-visible public IP' : 'Public internet address'}
                      address={publicAddress}
                      muted={Boolean(netSig?.interpretation.behindCgnat)}
                      note={netSig?.interpretation.behindCgnat ? 'Not directly reachable because your router is behind ISP NAT.' : `Share this after port ${hostPort} is reachable.`}
                      copied={copied}
                      onCopy={setCopied}
                    />
                  )}
                  <button
                    onClick={refreshNetworkScan}
                    disabled={scanningNetwork}
                    className="pt-1 text-[11px] text-mesh-text-muted transition-colors hover:text-mesh-text-primary disabled:opacity-50"
                  >
                    {scanningNetwork ? 'Checking network...' : 'Re-check network'}
                  </button>
                </div>
              )}
              {hostStatus.error && <div className="text-xs text-mesh-danger">{hostStatus.error}</div>}
            </div>
          </section>

          <section className="rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary/70 p-5">
            <PanelHeader
              icon={<Shield className="h-4 w-4" />}
              title="My Servers"
              detail={`${hostedServers.length} hosted`}
              tone={hostedServers.length > 0 ? 'online' : 'offline'}
            />
            <p className="mt-3 text-xs leading-relaxed text-mesh-text-muted">
              Choose which local host port and share IP each community uses.
            </p>
            <div className="mt-4 space-y-2">
              {hostedServers.length === 0 ? (
                <EmptyLine text="Servers you host will show their active IP and share action here." />
              ) : hostedServers.map((server) => {
                const avatar = serverAvatars[server.id]
                const assignment = defaultServerHostAssignment(server.id)
                const inviteAddress = `http://${assignment.address}:${assignment.port}`
                const live = (hostStatus.ports ?? []).includes(assignment.port)
                return (
                  <div key={server.id} className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/65 p-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg text-sm font-bold text-white"
                        style={avatar ? undefined : { backgroundColor: server.iconColor }}
                      >
                        {avatar ? <img src={avatar} alt={server.name} className="h-full w-full object-cover" draggable={false} /> : server.name[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-mesh-text-primary">{server.name}</div>
                        <div className="truncate font-mono text-[11px] text-mesh-text-muted">{inviteAddress}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-mesh-text-muted">
                          <StatusDot tone={live ? 'online' : 'offline'} />
                          <span>{server.memberCount} members</span>
                        </div>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => copyToClipboard(`${encodeConnectionCode(inviteAddress)} / ${server.id}`, setCopied)}>
                        Copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/channels/${server.id}`)}>
                        Open
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <select
                        value={assignment.port}
                        onChange={(e) => saveServerHostAssignment(server.id, { port: normalizePort(e.target.value) })}
                        className="h-8 rounded-md border border-mesh-border bg-mesh-bg-tertiary px-2 text-xs text-mesh-text-primary outline-none focus:border-mesh-green/60"
                      >
                        {hostPorts.map((port) => (
                          <option key={port} value={port}>
                            Port {port}{port === savedHostPort ? ' - primary' : ''}
                          </option>
                        ))}
                      </select>
                      <select
                        value={assignment.address}
                        onChange={(e) => saveServerHostAssignment(server.id, { address: e.target.value })}
                        className="h-8 rounded-md border border-mesh-border bg-mesh-bg-tertiary px-2 text-xs text-mesh-text-primary outline-none focus:border-mesh-green/60"
                      >
                        {hostAddressOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function PanelHeader({
  icon,
  title,
  detail,
  tone,
  children
}: {
  icon: JSX.Element
  title: string
  detail: string
  tone: 'online' | 'offline' | 'busy'
  children?: React.ReactNode
}): JSX.Element {
  return (
    <div className="group/header flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-mesh-border/60 bg-mesh-bg-primary text-mesh-green transition-all duration-200 group-hover/header:-translate-y-0.5 group-hover/header:scale-105 group-hover/header:border-mesh-green/50 group-hover/header:shadow-[0_0_18px_rgba(45,212,191,0.14)]">
          <span className="transition-transform duration-200 group-hover/header:rotate-6">
            {icon}
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-mesh-text-primary">{title}</h2>
            <StatusDot tone={tone} />
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-mesh-text-muted">{detail}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

function StatusDot({ tone }: { tone: 'online' | 'offline' | 'busy' }): JSX.Element {
  return (
    <span
      className={cn(
        'mt-1 inline-flex h-2 w-2 shrink-0 rounded-full',
        tone === 'online' && 'bg-mesh-green',
        tone === 'busy' && 'animate-pulse bg-mesh-warning',
        tone === 'offline' && 'bg-mesh-danger'
      )}
    />
  )
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3">
      <div className="text-[11px] text-mesh-text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold text-mesh-text-primary">{value}</div>
    </div>
  )
}

function CopyRow({
  label,
  value,
  tag,
  copied,
  onCopy
}: {
  label: string
  value: string
  tag?: string
  copied: string | null
  onCopy: (value: string | null) => void
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted">{label}</div>
        <div className="truncate font-mono text-[11px] text-mesh-text-primary">{value}</div>
      </div>
      {tag && <span className="shrink-0 rounded border border-mesh-border px-1.5 py-0.5 text-[10px] text-mesh-text-muted">{tag}</span>}
      <button
        onClick={() => copyToClipboard(value, onCopy)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
        title="Copy"
      >
        {copied === value ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

/** A shareable host address rendered as a MESH invite code (with the raw
 *  address kept as a small caption for reference). Copying yields the code, so
 *  the IP is never what gets pasted around — for any of the addresses, not
 *  just same-Wi-Fi. */
function ShareCodeRow({
  label,
  address,
  note,
  tag,
  muted,
  copied,
  onCopy
}: {
  label: string
  address: string
  note?: string
  tag?: string
  muted?: boolean
  copied: string | null
  onCopy: (value: string | null) => void
}): JSX.Element {
  const code = encodeConnectionCode(address)
  return (
    <div className={cn(
      'rounded-lg border px-3 py-2.5',
      muted
        ? 'border-mesh-warning/30 bg-mesh-warning/5'
        : 'border-mesh-border/60 bg-mesh-bg-primary/70'
    )}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted">{label}</span>
            {tag && <span className="rounded border border-mesh-border px-1.5 py-0.5 text-[9px] text-mesh-text-muted">{tag}</span>}
          </div>
          <div className="mt-0.5 break-all font-mono text-[11px] text-mesh-green">{code}</div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-mesh-text-muted/70">{address}</div>
        </div>
        <button
          onClick={() => copyToClipboard(code, onCopy)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
          title="Copy invite code"
        >
          {copied === code ? <Check className="h-3.5 w-3.5 text-mesh-green" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      {note && <div className="mt-1 text-[11px] leading-relaxed text-mesh-text-muted">{note}</div>}
    </div>
  )
}

function RowActions({
  onConnect,
  onScan,
  onRemove
}: {
  onConnect: () => void
  onScan: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={onConnect}
        className="grid h-7 w-7 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
        title="Connect"
      >
        <Wifi className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onScan}
        className="grid h-7 w-7 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
        title="Scan"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onRemove}
        className="grid h-7 w-7 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-danger/10 hover:text-mesh-danger"
        title="Remove"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function EmptyLine({ text }: { text: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-mesh-border/70 p-4 text-center text-xs text-mesh-text-muted">
      {text}
    </div>
  )
}

export { NetworkCenterPage }
