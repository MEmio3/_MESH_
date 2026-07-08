import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Link2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useServersStore } from '@/stores/servers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useSettingsStore } from '@/stores/settings.store'

interface CreateServerModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ParsedInvite {
  serverId: string
  hostUrl: string | null
}

function normalizeHostUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().replace(/[),.]+$/, '')
  if (!raw) return null
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withProtocol)
    if (!url.hostname || !url.port) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function parseInvite(input: string): ParsedInvite | null {
  const raw = input.trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol === 'mesh:') {
      const serverId = url.searchParams.get('server') || url.searchParams.get('serverId') || ''
      const hostUrl = normalizeHostUrl(url.searchParams.get('host'))
      if (serverId.startsWith('srv_')) return { serverId, hostUrl }
    }
  } catch {
    /* fall through to loose parsing */
  }

  const serverId = raw.match(/srv_[A-Za-z0-9_-]+/)?.[0] ?? ''
  if (!serverId) return null
  const hostMatch = raw.match(/https?:\/\/[^\s/]+(?::\d+)?/i)?.[0]
    ?? raw.match(/(?:\b|^)(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9.-]+\.[a-z]{2,})(?::\d{1,5})(?:\b|$)/i)?.[0]
  return { serverId, hostUrl: normalizeHostUrl(hostMatch) }
}

function CreateServerModal({ isOpen, onClose }: CreateServerModalProps): JSX.Element {
  const navigate = useNavigate()
  const createServer = useServersStore((s) => s.createServer)
  const joinServer = useServersStore((s) => s.joinServer)
  const identity = useIdentityStore((s) => s.identity)
  const updateNetwork = useSettingsStore((s) => s.updateNetwork)
  const [name, setName] = useState('')
  const [joinId, setJoinId] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim()
    const trimmedPass = password.trim()
    if (trimmed.length < 2 || busy) return
    setBusy(true); setError(null)
    
    let passwordHash = null
    if (trimmedPass.length > 0) {
      passwordHash = await window.api.crypto.hashPassword(trimmedPass)
    }

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

  const handleJoin = async (): Promise<void> => {
    const parsed = parseInvite(joinId)
    const trimmedPass = password.trim()
    if (!parsed || busy) return
    setBusy(true); setError(null)

    if (parsed.hostUrl) {
      if (!identity) {
        setBusy(false)
        setError('No identity found. Restart the app setup first.')
        return
      }
      try {
        await window.api.signaling.connect(parsed.hostUrl, identity.userId)
        const connected = await window.api.signaling.isConnected()
        if (!connected) {
          setBusy(false)
          setError('Could not connect to the host address in this invite.')
          return
        }
        updateNetwork({ signalingUrl: parsed.hostUrl })
      } catch {
        setBusy(false)
        setError('Could not connect to the host address in this invite.')
        return
      }
    }

    let passwordHash = null
    if (trimmedPass.length > 0) {
      passwordHash = await window.api.crypto.hashPassword(trimmedPass)
    }

    const res = await joinServer(parsed.serverId, passwordHash)
    setBusy(false)
    if (!res.success) {
      setError(res.error ?? 'Failed to join server')
      return
    }
    onClose()
    setJoinId('')
    setPassword('')
    navigate(`/channels/${parsed.serverId}`)
  }

  const handleClose = () => {
    setName('')
    setJoinId('')
    setPassword('')
    setError(null)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={mode === 'create' ? 'Create a Server' : 'Join a Server'}>
      {/* Mode Switcher */}
      <div className="flex gap-1 mb-5 bg-mesh-bg-primary p-1 rounded-lg">
        <button
          onClick={() => setMode('create')}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'create' ? 'bg-mesh-green text-white' : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary/50'}`}
        >
          Create
        </button>
        <button
          onClick={() => setMode('join')}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'join' ? 'bg-mesh-green text-white' : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary/50'}`}
        >
          Join
        </button>
      </div>

      {mode === 'create' ? (
        <div>
          <label className="block text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-2">
            Server Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="My Awesome Server"
            maxLength={50}
            autoFocus
            className="w-full h-11 px-4 rounded-lg bg-mesh-bg-tertiary text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border border-none mb-4"
          />
          <label className="block text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-2 mt-4">
            Password (Optional)
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Leave blank for public server"
            className="w-full h-11 px-4 rounded-lg bg-mesh-bg-tertiary text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border border-none mb-6"
          />
          <Button onClick={handleCreate} disabled={name.trim().length < 2 || busy} className="w-full">
            {busy ? 'Creating…' : 'Create Server'}
          </Button>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400 mt-3">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-2">
            Invite or Server ID
          </label>
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/60 px-3 py-2 text-xs text-mesh-text-muted">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mesh-green" />
            <span>Paste the full invite from your friend. Plain server IDs still work after you are connected to that host.</span>
          </div>
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="mesh://join?host=http%3A...&server=srv_..."
            autoFocus
            className="w-full h-11 px-4 rounded-lg bg-mesh-bg-tertiary text-sm text-mesh-text-primary font-mono placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border border-none mb-4"
          />
          <label className="block text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-2 mt-4">
            Password (Optional)
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="Only if required"
            className="w-full h-11 px-4 rounded-lg bg-mesh-bg-tertiary text-sm text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:ring-1 focus:ring-mesh-border border-none mb-6"
          />
          <Button onClick={handleJoin} disabled={!parseInvite(joinId) || busy} className="w-full">
            {busy ? 'Joining…' : 'Join Server'}
          </Button>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400 mt-3">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

export { CreateServerModal }
