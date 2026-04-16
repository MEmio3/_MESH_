import { useParams, Navigate } from 'react-router-dom'
import { Hash } from 'lucide-react'
import { useServersStore } from '@/stores/servers.store'
import { ServerTextChannel } from './ServerTextChannel'

function ServerPage(): JSX.Element {
  const { serverId } = useParams<{ serverId: string }>()
  const servers = useServersStore((s) => s.servers)
  const pendingJoin = useServersStore((s) => s.pendingJoin)
  const lastError = useServersStore((s) => s.lastError)
  const server = servers.find((s) => s.id === serverId)

  // Show loading state while joining
  if (pendingJoin === serverId) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="h-16 w-16 rounded-2xl bg-mesh-bg-tertiary flex items-center justify-center mb-4">
          <div className="h-8 w-8 rounded-full border-2 border-mesh-green border-t-transparent animate-spin" />
        </div>
        <p className="text-sm text-mesh-text-muted">Joining server...</p>
      </div>
    )
  }

  // Show error state
  if (lastError && !server) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="h-16 w-16 rounded-2xl bg-mesh-bg-tertiary flex items-center justify-center mb-4">
          <Hash className="h-8 w-8 text-mesh-danger" />
        </div>
        <p className="text-sm text-mesh-danger">{lastError}</p>
      </div>
    )
  }

  if (!server) {
    // If we have a serverId param but no server data, redirect to home
    if (serverId && serverId !== '@me') {
      console.warn('[ServerPage] Server not found:', serverId, '- redirecting to home')
      return <Navigate to="/channels/@me" replace />
    }
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="h-16 w-16 rounded-2xl bg-mesh-bg-tertiary flex items-center justify-center mb-4">
          <Hash className="h-8 w-8 text-mesh-text-muted" />
        </div>
        <p className="text-sm text-mesh-text-muted">Select a server to view</p>
      </div>
    )
  }

  // Default view is the text channel
  return <ServerTextChannel server={server} />
}

export { ServerPage }
