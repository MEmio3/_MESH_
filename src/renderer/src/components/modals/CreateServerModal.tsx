import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Link2, Loader2, Server, Wifi } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useServersStore } from '@/stores/servers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'
import { ensureHostConnection } from '@/lib/host-connection'
import { normalizeInviteHost, parseServerInvite } from '@/lib/server-invite'
import { waitForJoinedServer } from '@/lib/server-join'

interface CreateServerModalProps {
  isOpen: boolean
  onClose: () => void
  initialInvite?: string | null
}

interface InvitePreview {
  name: string
  memberCount: number
  onlineMemberCount: number
  requiresPassword: boolean
  avatarDataUrl: string | null
}

async function discoverInviteRoute(hostUrls: string[], serverId: string): Promise<{
  hostUrl: string
  server: Awaited<ReturnType<typeof window.api.networkDiscovery.fetchServers>>['servers'][number]
}> {
  const routes = [...new Set(hostUrls.map(normalizeInviteHost).filter((route): route is string => Boolean(route)))]
  if (routes.length === 0) throw new Error('This invitation does not contain a usable host route.')

  const statuses = await window.api.signaling.listHostStatuses().catch(() => [])
  const connected = new Set(
    statuses
      .filter((status) => status.state === 'connected')
      .map((status) => normalizeInviteHost(status.url)?.toLowerCase())
      .filter((route): route is string => Boolean(route))
  )
  routes.sort((left, right) => Number(connected.has(right.toLowerCase())) - Number(connected.has(left.toLowerCase())))

  return new Promise((resolve, reject) => {
    let pending = routes.length
    let settled = false
    const errors: string[] = []
    for (const hostUrl of routes) {
      window.api.networkDiscovery.fetchServers({ url: hostUrl })
        .then((probe) => {
          if (settled) return
          const server = probe.success ? probe.servers.find((entry) => entry.id === serverId) : null
          if (server) {
            settled = true
            resolve({ hostUrl, server })
            return
          }
          errors.push(probe.error || `${new URL(hostUrl).host} did not expose this server.`)
          pending -= 1
          if (pending === 0) reject(new Error(errors[0] || 'None of the invitation routes are reachable.'))
        })
        .catch((error) => {
          if (settled) return
          errors.push(error instanceof Error ? error.message : String(error))
          pending -= 1
          if (pending === 0) reject(new Error(errors[0] || 'None of the invitation routes are reachable.'))
        })
    }
  })
}

function CreateServerModal({ isOpen, onClose, initialInvite = null }: CreateServerModalProps): JSX.Element {
  const navigate = useNavigate()
  const createServer = useServersStore((state) => state.createServer)
  const joinServer = useServersStore((state) => state.joinServer)
  const identity = useIdentityStore((state) => state.identity)
  const setServerAvatarLocal = useServerAvatarStore((state) => state.setLocal)
  const operation = useRef(0)
  const [name, setName] = useState('')
  const [joinId, setJoinId] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<'checking' | 'connecting' | 'joining' | null>(null)
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const parsedInvite = useMemo(() => parseServerInvite(joinId), [joinId])

  useEffect(() => {
    if (!isOpen || !initialInvite) return
    operation.current += 1
    setMode('join')
    setJoinId(initialInvite)
    setPassword('')
    setPreview(null)
    setError(null)
    setBusy(false)
    setProgress(null)
  }, [initialInvite, isOpen])

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim()
    const trimmedPass = password.trim()
    if (trimmed.length < 2 || busy) return
    setBusy(true)
    setError(null)

    const passwordHash = trimmedPass ? await window.api.crypto.hashPassword(trimmedPass) : null
    const res = await createServer({ name: trimmed, passwordHash })
    setBusy(false)
    if (!res.success || !res.serverId) {
      setError(res.error ?? 'Failed to create server')
      return
    }
    onClose()
    setName('')
    setPassword('')
    navigate(`/channels/${res.serverId}`)
  }

  const rememberInviteRoute = (serverId: string, hostUrl: string, serverName: string, becamePrimary: boolean): void => {
    const settings = useSettingsStore.getState()
    const network = settings.network
    const normalized = normalizeInviteHost(hostUrl)
    if (!normalized) return
    const known = network.knownNetworks.some((entry) => normalizeInviteHost(entry.url) === normalized)
      ? network.knownNetworks
      : [...network.knownNetworks, {
          id: `net_${Date.now().toString(36)}`,
          name: serverName || new URL(normalized).host,
          url: normalized
        }]
    settings.updateNetwork({
      knownNetworks: known,
      joinedServerHosts: { ...network.joinedServerHosts, [serverId]: normalized },
      ...(becamePrimary ? { signalingUrl: normalized } : {})
    })
  }

  const handleJoin = async (): Promise<void> => {
    const parsed = parseServerInvite(joinId)
    if (!parsed || busy) {
      if (!parsed) setError('Paste a valid MESH invitation or server ID.')
      return
    }
    if (!identity) {
      setError('No identity found. Restart the app setup first.')
      return
    }
    if (useServersStore.getState().servers.some((server) => server.id === parsed.serverId)) {
      onClose()
      navigate(`/channels/${parsed.serverId}`)
      return
    }

    const currentOperation = ++operation.current
    setBusy(true)
    setError(null)
    setPreview(null)

    try {
      let discovered: InvitePreview | null = null
      let becamePrimary = false
      let activeHostUrl = parsed.hostUrl

      if (parsed.hostUrls.length > 0) {
        setProgress('checking')
        const route = await discoverInviteRoute(parsed.hostUrls, parsed.serverId)
        activeHostUrl = route.hostUrl
        const server = route.server
        discovered = {
          name: server.name,
          memberCount: server.memberCount,
          onlineMemberCount: server.onlineMemberCount,
          requiresPassword: server.requiresPassword,
          avatarDataUrl: server.avatarDataUrl
        }
        if (currentOperation !== operation.current) return
        setPreview(discovered)
        if (server.requiresPassword && !password.trim()) {
          throw new Error('This server requires a password.')
        }

        setProgress('connecting')
        const connection = await ensureHostConnection(activeHostUrl, identity.userId)
        becamePrimary = connection.becamePrimary
      }

      const passwordHash = password.trim()
        ? await window.api.crypto.hashPassword(password.trim())
        : null
      setProgress('joining')
      const res = await joinServer(parsed.serverId, passwordHash, activeHostUrl)
      if (!res.success) throw new Error(res.error ?? 'Failed to join server.')
      await waitForJoinedServer(parsed.serverId)
      if (currentOperation !== operation.current) return

      if (discovered?.avatarDataUrl) setServerAvatarLocal(parsed.serverId, discovered.avatarDataUrl)
      if (activeHostUrl) {
        rememberInviteRoute(
          parsed.serverId,
          activeHostUrl,
          discovered?.name || parsed.serverName || 'MESH network',
          becamePrimary
        )
      }

      operation.current += 1
      onClose()
      setJoinId('')
      setPassword('')
      setPreview(null)
      navigate(`/channels/${parsed.serverId}`)
    } catch (err) {
      if (currentOperation === operation.current) {
        setError(err instanceof Error ? err.message : 'Failed to join server.')
      }
    } finally {
      if (currentOperation === operation.current) {
        setBusy(false)
        setProgress(null)
      }
    }
  }

  const handleClose = (): void => {
    operation.current += 1
    setName('')
    setJoinId('')
    setPassword('')
    setPreview(null)
    setError(null)
    setBusy(false)
    setProgress(null)
    onClose()
  }

  const joinButtonLabel = progress === 'checking'
    ? 'Checking invite...'
    : progress === 'connecting'
      ? 'Connecting host...'
      : progress === 'joining'
        ? 'Joining server...'
        : 'Join Server'

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={mode === 'create' ? 'Create a Server' : 'Join a Server'}>
      <div className="mb-5 flex gap-1 rounded-lg bg-mesh-bg-primary p-1">
        <button
          onClick={() => setMode('create')}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === 'create' ? 'bg-mesh-green text-white' : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/50 hover:text-mesh-text-primary'}`}
        >
          Create
        </button>
        <button
          onClick={() => setMode('join')}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === 'join' ? 'bg-mesh-green text-white' : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/50 hover:text-mesh-text-primary'}`}
        >
          Join
        </button>
      </div>

      {mode === 'create' ? (
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-mesh-text-secondary">
            Server Name
          </label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
            placeholder="My Awesome Server"
            maxLength={50}
            autoFocus
            className="mb-4 h-11 w-full rounded-lg border-none bg-mesh-bg-tertiary px-4 text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border"
          />
          <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wide text-mesh-text-secondary">
            Password (Optional)
          </label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
            placeholder="Leave blank for public server"
            className="mb-6 h-11 w-full rounded-lg border-none bg-mesh-bg-tertiary px-4 text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border"
          />
          <Button onClick={handleCreate} disabled={name.trim().length < 2 || busy} className="w-full">
            {busy ? 'Creating...' : 'Create Server'}
          </Button>
          {error && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
        </div>
      ) : (
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-mesh-text-secondary">
            Invitation
          </label>
          <div className="mb-2 flex items-center gap-2 text-xs text-mesh-text-muted">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-mesh-green" />
            <span>Paste an invitation link or a server ID.</span>
          </div>
          <input
            value={joinId}
            onChange={(event) => {
              setJoinId(event.target.value)
              setPreview(null)
              setError(null)
            }}
            onKeyDown={(event) => event.key === 'Enter' && void handleJoin()}
            placeholder="mesh://join?..."
            autoFocus
            className="mb-3 h-11 w-full rounded-lg border-none bg-mesh-bg-tertiary px-4 font-mono text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border"
          />

          {parsedInvite && (
            <div className="mb-4 flex min-h-14 items-center gap-3 border-y border-mesh-border/60 py-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-mesh-green/10 text-mesh-green">
                <Server className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-mesh-text-primary">
                  {preview?.name || parsedInvite.serverName || 'MESH server'}
                </p>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-mesh-text-muted">
                  <Wifi className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {parsedInvite.hostUrl
                      ? `${new URL(parsedInvite.hostUrl).host}${parsedInvite.hostUrls.length > 1 ? ` +${parsedInvite.hostUrls.length - 1} fallback` : ''}`
                      : 'Current network'}
                  </span>
                </div>
              </div>
              {preview && (
                <div className="shrink-0 text-right text-[11px] text-mesh-text-muted">
                  <p className="flex items-center justify-end gap-1 text-mesh-green">
                    <CheckCircle2 className="h-3 w-3" /> Reachable
                  </p>
                  <p>{preview.onlineMemberCount}/{preview.memberCount} online</p>
                </div>
              )}
            </div>
          )}

          <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wide text-mesh-text-secondary">
            Password {preview?.requiresPassword ? '' : '(Optional)'}
          </label>
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => event.key === 'Enter' && void handleJoin()}
            placeholder={preview?.requiresPassword ? 'Required by this server' : 'Only if required'}
            className="mb-6 h-11 w-full rounded-lg border-none bg-mesh-bg-tertiary px-4 text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border"
          />
          <Button onClick={handleJoin} disabled={!parsedInvite || busy} className="w-full">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {joinButtonLabel}
          </Button>
          {error && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-red-400">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

export { CreateServerModal }
