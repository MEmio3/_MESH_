import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Router,
  Server,
  Trash2,
  Users,
  Wifi
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useIdentityStore } from '@/stores/identity.store'
import { useServersStore } from '@/stores/servers.store'
import { type KnownNetwork, useSettingsStore } from '@/stores/settings.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'

type DiscoveryNetwork = KnownNetwork & { current?: boolean }

interface DiscoveredServer {
  id: string
  name: string
  iconColor: string
  avatarDataUrl: string | null
  textChannelName: string
  voiceRoomName: string
  hostUserId: string
  hostUsername: string
  hostAvatarColor: string | null
  memberCount: number
  onlineMemberCount: number
  requiresPassword: boolean
}

interface ProbeResult {
  success: boolean
  url: string
  latencyMs: number | null
  servers: DiscoveredServer[]
  error?: string
  loading?: boolean
}

function normalizeNetworkUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

function networkKey(network: DiscoveryNetwork): string {
  return `${network.id}:${normalizeNetworkUrl(network.url)}`
}

function DiscoveryPage(): JSX.Element {
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const network = useSettingsStore((s) => s.network)
  const updateNetwork = useSettingsStore((s) => s.updateNetwork)
  const joinServer = useServersStore((s) => s.joinServer)
  const joinedServers = useServersStore((s) => s.servers)
  const serverAvatars = useServerAvatarStore((s) => s.byServer)
  const setServerAvatarLocal = useServerAvatarStore((s) => s.setLocal)

  const [draftName, setDraftName] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  const [results, setResults] = useState<Record<string, ProbeResult>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const [joining, setJoining] = useState<string | null>(null)

  const activeUrl = normalizeNetworkUrl(network.signalingUrl || 'http://localhost:3000')
  const networks = useMemo<DiscoveryNetwork[]>(() => {
    const seen = new Set<string>()
    const current: DiscoveryNetwork = { id: 'current', name: 'Current Network', url: activeUrl, current: true }
    seen.add(activeUrl.toLowerCase())
    const saved = network.knownNetworks
      .map((n) => ({ ...n, url: normalizeNetworkUrl(n.url) }))
      .filter((n) => {
        const key = n.url.toLowerCase()
        if (!n.url || seen.has(key)) return false
        seen.add(key)
        return true
      })
    return [current, ...saved]
  }, [activeUrl, network.knownNetworks])

  const knownServerIds = new Set(joinedServers.map((s) => s.id))
  const allServers = networks.flatMap((n) => {
    const result = results[networkKey(n)]
    return (result?.servers ?? []).map((server) => ({ network: n, server }))
  })

  async function refreshNetwork(net: DiscoveryNetwork): Promise<void> {
    const key = networkKey(net)
    setResults((s) => ({
      ...s,
      [key]: { success: false, url: normalizeNetworkUrl(net.url), latencyMs: null, servers: s[key]?.servers ?? [], loading: true }
    }))
    const result = await window.api.networkDiscovery.fetchServers({ url: net.url })
    for (const server of result.servers) {
      if (server.avatarDataUrl) setServerAvatarLocal(server.id, server.avatarDataUrl)
    }
    setResults((s) => ({ ...s, [key]: { ...result, loading: false } }))
  }

  async function refreshAll(): Promise<void> {
    await Promise.all(networks.map(refreshNetwork))
  }

  useEffect(() => {
    void refreshAll()
    // Run once on page entry; add/remove actions refresh their own rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addNetwork(): void {
    const url = normalizeNetworkUrl(draftUrl)
    if (!url) {
      setNotice('Enter an IP:port or signaling URL.')
      return
    }
    const duplicate = networks.some((n) => normalizeNetworkUrl(n.url).toLowerCase() === url.toLowerCase())
    if (duplicate) {
      setNotice('That network is already in Discovery.')
      return
    }
    let fallbackName = url
    try {
      fallbackName = new URL(url).host
    } catch { /* keep raw url */ }
    const next: KnownNetwork = {
      id: `net_${Date.now().toString(36)}`,
      name: draftName.trim() || fallbackName,
      url
    }
    updateNetwork({ knownNetworks: [...network.knownNetworks, next] })
    setDraftName('')
    setDraftUrl('')
    setNotice('Network added.')
    void refreshNetwork(next)
  }

  function removeNetwork(id: string): void {
    updateNetwork({ knownNetworks: network.knownNetworks.filter((n) => n.id !== id) })
    setResults((s) => {
      const next = { ...s }
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${id}:`)) delete next[key]
      }
      return next
    })
  }

  async function joinDiscoveredServer(net: DiscoveryNetwork, server: DiscoveredServer): Promise<void> {
    if (!identity) return
    const rowKey = `${networkKey(net)}:${server.id}`
    const password = (passwords[rowKey] ?? '').trim()
    if (server.requiresPassword && password.length === 0) {
      setNotice('This server needs a password.')
      return
    }

    setJoining(rowKey)
    setNotice(null)
    try {
      const targetUrl = normalizeNetworkUrl(net.url)
      if (server.avatarDataUrl) setServerAvatarLocal(server.id, server.avatarDataUrl)
      if (targetUrl !== activeUrl) {
        updateNetwork({ signalingUrl: targetUrl })
        await window.api.signaling.connect(targetUrl, identity.userId)
      }
      const passwordHash = password ? await window.api.crypto.hashPassword(password) : null
      const res = await joinServer(server.id, passwordHash)
      if (!res.success) {
        setNotice(res.error ?? 'Failed to join server.')
        return
      }
      navigate(`/channels/${server.id}`)
    } finally {
      setJoining(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-mesh-bg-primary">
      <div className="shrink-0 border-b border-mesh-border/60 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary text-mesh-green">
              <Compass className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-mesh-text-primary">Discovery</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mesh-text-muted">
                <span>{networks.length} networks</span>
                <span className="h-1 w-1 rounded-full bg-mesh-text-muted/60" />
                <span>{allServers.length} live servers</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/network-center')}>
              <Router className="mr-2 h-4 w-4" />
              Network
            </Button>
            <Button variant="secondary" onClick={refreshAll}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-h-0 border-r border-mesh-border/60 bg-mesh-bg-secondary/55 p-4">
          <div className="mb-4 space-y-2">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Friend or host name"
              className="h-9 w-full rounded-md border border-mesh-border bg-mesh-bg-primary px-3 text-sm text-mesh-text-primary outline-none placeholder:text-mesh-text-muted focus:border-mesh-green/60"
            />
            <div className="flex gap-2">
              <input
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNetwork()}
                placeholder="192.168.0.23:3000"
                className="h-9 min-w-0 flex-1 rounded-md border border-mesh-border bg-mesh-bg-primary px-3 font-mono text-xs text-mesh-text-primary outline-none placeholder:text-mesh-text-muted focus:border-mesh-green/60"
              />
              <button
                onClick={addNetwork}
                className="mesh-pressable grid h-9 w-9 shrink-0 place-items-center rounded-md bg-mesh-green text-white hover:bg-mesh-green-light"
                title="Add network"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-muted">Networks</span>
            <span className="text-[11px] text-mesh-text-muted">{networks.length}</span>
          </div>

          <div className="space-y-1.5">
            {networks.map((net) => {
              const key = networkKey(net)
              const result = results[key]
              const online = result?.success
              return (
                <div
                  key={key}
                  className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/70 p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className={cn('mt-1 h-2 w-2 rounded-full', online ? 'bg-mesh-green' : result?.loading ? 'bg-mesh-warning' : 'bg-mesh-text-muted')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-mesh-text-primary">{net.name}</span>
                        {net.current && (
                          <span className="rounded-full border border-mesh-green/30 bg-mesh-green/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-mesh-green">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-mesh-text-muted">{normalizeNetworkUrl(net.url)}</div>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-mesh-text-muted">
                        {result?.loading ? (
                          <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Scanning</span>
                        ) : online ? (
                          <span className="inline-flex items-center gap-1 text-mesh-green"><CheckCircle2 className="h-3 w-3" /> {result.servers.length} servers</span>
                        ) : (
                          <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {result?.error ?? 'Not scanned'}</span>
                        )}
                        {result?.latencyMs !== null && result?.latencyMs !== undefined && (
                          <span>{result.latencyMs}ms</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => refreshNetwork(net)}
                        className="mesh-icon-button mesh-icon-search grid h-7 w-7 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary"
                        title="Scan"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      {!net.current && (
                        <button
                          onClick={() => removeNetwork(net.id)}
                          className="mesh-icon-button grid h-7 w-7 place-items-center rounded-md text-mesh-text-muted hover:bg-mesh-danger/10 hover:text-mesh-danger"
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto p-6">
          {notice && (
            <div className="mb-4 rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary px-4 py-3 text-sm text-mesh-text-secondary">
              {notice}
            </div>
          )}

          {allServers.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
              <Wifi className="mb-4 h-14 w-14 text-mesh-text-muted" strokeWidth={1.4} />
              <h2 className="text-lg font-semibold text-mesh-text-primary">No live servers found</h2>
              <p className="mt-2 max-w-md text-sm text-mesh-text-muted">
                Add a friend host or refresh networks that are already saved.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {allServers.map(({ network: net, server }) => {
                const rowKey = `${networkKey(net)}:${server.id}`
                const isJoined = knownServerIds.has(server.id)
                const isJoining = joining === rowKey
                const avatarSrc = server.avatarDataUrl || serverAvatars[server.id]
                return (
                  <div
                    key={rowKey}
                    className="mesh-hover-lift rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg text-base font-bold text-white"
                        style={avatarSrc ? undefined : { backgroundColor: server.iconColor }}
                      >
                        {avatarSrc ? (
                          <img
                            src={avatarSrc}
                            alt={server.name}
                            className="h-full w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          server.name.slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-base font-bold text-mesh-text-primary">{server.name}</h3>
                          {server.requiresPassword && <Lock className="h-3.5 w-3.5 shrink-0 text-mesh-text-muted" />}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mesh-text-muted">
                          <span className="inline-flex items-center gap-1"><Server className="h-3 w-3" /> {net.name}</span>
                          <span className="h-1 w-1 rounded-full bg-mesh-text-muted/60" />
                          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {server.onlineMemberCount}/{server.memberCount}</span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-mesh-text-muted">
                          Hosted by {server.hostUsername}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      {server.requiresPassword && !isJoined && (
                        <input
                          type="password"
                          value={passwords[rowKey] ?? ''}
                          onChange={(e) => setPasswords((s) => ({ ...s, [rowKey]: e.target.value }))}
                          placeholder="Password"
                          className="h-9 min-w-0 flex-1 rounded-md border border-mesh-border bg-mesh-bg-primary px-3 text-sm text-mesh-text-primary outline-none placeholder:text-mesh-text-muted focus:border-mesh-green/60"
                        />
                      )}
                      <Button
                        size="sm"
                        variant={isJoined ? 'secondary' : 'primary'}
                        disabled={isJoining}
                        onClick={() => isJoined ? navigate(`/channels/${server.id}`) : joinDiscoveredServer(net, server)}
                        className={cn(!server.requiresPassword || isJoined ? 'ml-auto' : '')}
                      >
                        {isJoining ? 'Joining...' : isJoined ? 'Open' : normalizeNetworkUrl(net.url) === activeUrl ? 'Join' : 'Connect & Join'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export { DiscoveryPage }
