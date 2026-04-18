import { useState } from 'react'
import { Hash, Users, Search, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServersStore } from '@/stores/servers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { MessageFeed } from '@/components/chat/MessageFeed'
import { MessageInput } from '@/components/chat/MessageInput'
import { MemberListPanel } from '@/components/server/MemberListPanel'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Server } from '@/types/server'

interface ServerTextChannelProps {
  server: Server
  /**
   * Optional channel name override (from the routed `:channelId`). Falls
   * back to the legacy `displayName` when unset so servers
   * without the new channel layout still render correctly.
   */
  channelName?: string
  /**
   * Channel id used to scope messages — the feed only renders messages whose
   * `channelId` matches (or legacy rows with no channelId, when this is the
   * server's default text channel). Without this, every new channel inherits
   * the default channel's chat history.
   */
  channelId?: string
  /** True when `channelId` is the server's implicit default text channel. */
  isDefaultChannel?: boolean
}

function ServerTextChannel({ server, channelName, channelId, isDefaultChannel }: ServerTextChannelProps): JSX.Element {
  const displayName = channelName || server.textChannelName
  const [showMembers, setShowMembers] = useState(true)
  const allMessages = useServersStore((s) => s.serverMessages[server.id] || [])
  // Filter to this channel. Legacy messages (channelId === null) only show in
  // the default channel so nothing silently vanishes after the migration.
  const messages = channelId
    ? allMessages.filter((m) => m.channelId === channelId || (isDefaultChannel && !m.channelId))
    : allMessages
  const members = useServersStore((s) => s.serverMembers[server.id] || [])
  const sendMessage = useServersStore((s) => s.sendServerMessage)
  const editServerMessage = useServersStore((s) => s.editServerMessage)
  const deleteServerMessage = useServersStore((s) => s.deleteServerMessage)
  const toggleServerReaction = useServersStore((s) => s.toggleServerReaction)
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfMember = members.find((m) => m.userId === selfId)
  const isModerator = selfMember?.role === 'host' || selfMember?.role === 'moderator'

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between h-12 px-4 border-b border-mesh-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Hash className="h-5 w-5 text-mesh-text-muted shrink-0" />
            <span className="text-base font-semibold text-mesh-text-primary whitespace-nowrap">
              {displayName}
            </span>
            <div className="h-5 w-px bg-mesh-border/50 mx-2 shrink-0" />
            <span className="text-sm text-mesh-text-muted truncate">
              Welcome to #{displayName}
            </span>
          </div>
          
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <Tooltip content="Search" side="bottom">
              <button className="h-8 w-8 rounded flex items-center justify-center text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors">
                <Search className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
            <Tooltip content="Inbox" side="bottom">
              <button className="h-8 w-8 rounded flex items-center justify-center text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors">
                <Bell className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
            <Tooltip content={showMembers ? 'Hide Members' : 'Show Members'} side="bottom">
              <button
                onClick={() => setShowMembers(!showMembers)}
                className={cn(
                  "h-8 w-8 rounded flex items-center justify-center transition-colors",
                  showMembers 
                    ? "text-mesh-text-primary bg-mesh-bg-tertiary" 
                    : "text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary"
                )}
              >
                <Users className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Messages */}
        <MessageFeed
          messages={messages}
          recipientName={displayName}
          onEditMessage={(messageId, newContent) => editServerMessage(server.id, messageId, newContent)}
          onDeleteMessage={(messageId) => deleteServerMessage(server.id, messageId)}
          onToggleReaction={(messageId, emojiId) => toggleServerReaction(server.id, messageId, emojiId)}
          canDeleteMessage={(msg) => msg.senderId === selfId || isModerator}
        />

        {/* Input — file sharing available (relayed through signaling for servers) */}
        <MessageInput
          recipientName={displayName}
          onSend={(content) => sendMessage(server.id, content, channelId ?? null)}
          onSendFile={async (filePath) => {
            const fileData = await window.api.file.read(filePath)
            if (!fileData) return
            // Images < 2MB → embed as data URL inline so server members see preview.
            // Larger files / non-images → fall back to text reference (no P2P in servers).
            const isImage = fileData.fileType.startsWith('image/')
            if (isImage && fileData.fileSize <= 2 * 1024 * 1024) {
              sendMessage(server.id, `data:${fileData.fileType};base64,${fileData.base64}`, channelId ?? null)
            } else {
              sendMessage(server.id, `[File: ${fileData.fileName} (${(fileData.fileSize / 1024).toFixed(1)} KB)]`, channelId ?? null)
            }
          }}
        />
      </div>

      {/* Member list */}
      {showMembers && <MemberListPanel serverId={server.id} members={members} />}
    </div>
  )
}

export { ServerTextChannel }
