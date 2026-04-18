import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Hash, AlertTriangle } from 'lucide-react'
import { useServersStore } from '@/stores/servers.store'
import { useChannelsStore, useServerLayout } from '@/stores/channels.store'
import { ServerTextChannel } from './ServerTextChannel'

function ServerPage(): JSX.Element {
  const navigate = useNavigate()
  const { serverId, channelId } = useParams<{ serverId: string; channelId?: string }>()
  const servers = useServersStore((s) => s.servers)
  const pendingJoin = useServersStore((s) => s.pendingJoin)
  const lastError = useServersStore((s) => s.lastError)
  const server = servers.find((s) => s.id === serverId)
  const layout = useServerLayout(serverId ?? '')
  const load = useChannelsStore((s) => s.load)

  useEffect(() => { if (serverId) load(serverId) }, [serverId, load])

  // Resolve the channel to render: explicit :channelId wins, else first text
  // channel, else null (falls back to default empty view).
  const activeChannel = useMemo(() => {
    if (channelId) return layout.channels.find((c) => c.id === channelId) ?? null
    return layout.channels.find((c) => c.type === 'text') ?? null
  }, [channelId, layout])

  // Show loading state while joining
  if (pendingJoin === serverId) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-mesh-bg-primary">
        <div className="h-16 w-16 rounded-2xl bg-mesh-bg-tertiary flex items-center justify-center mb-4">
          <div className="h-8 w-8 rounded-full border-2 border-mesh-green border-t-transparent animate-spin" />
        </div>
        <p className="text-sm text-mesh-text-muted">Joining server…</p>
      </div>
    )
  }

  // Show error state — either the join failed or the server we navigated to
  // isn't in our store. Give the user an explicit way back so they aren't
  // stuck on what would otherwise look like a blank page.
  if (!server) {
    const message = lastError
      || (serverId && serverId !== '@me' ? 'This server is not available. It may be offline or you may have left it.' : 'Select a server to view')
    const isError = !!lastError || (serverId && serverId !== '@me')
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 px-6 text-center bg-mesh-bg-primary">
        <div className={`h-14 w-14 rounded-2xl flex items-center justify-center ${isError ? 'bg-mesh-danger/15' : 'bg-mesh-bg-tertiary'}`}>
          {isError
            ? <AlertTriangle className="h-7 w-7 text-mesh-danger" />
            : <Hash className="h-7 w-7 text-mesh-text-muted" />}
        </div>
        <p className={`text-sm max-w-md ${isError ? 'text-mesh-text-primary' : 'text-mesh-text-muted'}`}>{message}</p>
        {isError && (
          <button
            onClick={() => navigate('/channels/@me')}
            className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-mesh-green text-white text-xs font-semibold hover:bg-mesh-green/90 transition-colors"
          >
            Back to Home
          </button>
        )}
      </div>
    )
  }

  // Text channel view. Header name prefers the selected channel, else the
  // legacy `textChannelName` on the server row. Voice channels are joined
  // inline from the sidebar (see ChannelTree) so they don't need a page.
  const name = activeChannel?.type === 'text' ? activeChannel.name : undefined
  // The seed migration (`seedDefaultServerChannelsIfMissing`) backfills legacy
  // server_messages rows to this id. We treat it as the "default" channel so
  // pre-migration history still shows up here and nowhere else.
  const defaultChannelId = `${server.id}__ch-text-default`
  // Use a distinct local name — `channelId` is already bound from useParams above.
  const activeChannelId = activeChannel?.type === 'text' ? activeChannel.id : undefined
  const isDefaultChannel = activeChannelId === defaultChannelId
  return (
    <ServerTextChannel
      server={server}
      channelName={name}
      channelId={activeChannelId}
      isDefaultChannel={isDefaultChannel}
    />
  )
}

export { ServerPage }
