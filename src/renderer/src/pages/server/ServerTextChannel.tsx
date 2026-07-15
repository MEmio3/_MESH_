import { useCallback, useEffect, useRef, useState } from 'react'
import { Hash, Pin, Search, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServersStore } from '@/stores/servers.store'
import { useIdentityStore } from '@/stores/identity.store'
import { MessageFeed } from '@/components/chat/MessageFeed'
import { MessageInput } from '@/components/chat/MessageInput'
import { MessageToolsPanel, type MessageToolsMode } from '@/components/chat/MessageToolsPanel'
import { MemberListPanel } from '@/components/server/MemberListPanel'
import { Tooltip } from '@/components/ui/Tooltip'
import { useServerLayout } from '@/stores/channels.store'
import { PERM, effectivePermissions, hasPerm, resolveChannelPerm, type ChannelPermKey } from '../../../../shared/permissions'
import type { Server } from '@/types/server'
import type { Message, MessageSearchOptions } from '@/types/messages'
import { useLocation } from 'react-router-dom'
import { serverInboxScope, useInboxStore } from '@/stores/inbox.store'

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
  const location = useLocation()
  const displayName = channelName || server.textChannelName
  const [showMembers, setShowMembers] = useState(true)
  const [toolsMode, setToolsMode] = useState<MessageToolsMode | null>(null)
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null)
  const [replyTarget, setReplyTarget] = useState<Message | null>(null)
  const markInboxScopeRead = useInboxStore((s) => s.markScopeRead)
  const markInboxMessageRead = useInboxStore((s) => s.markMessageRead)
  useEffect(() => setReplyTarget(null), [server.id, channelId])
  const allMessages = useServersStore((s) => s.serverMessages[server.id] || [])
  // Filter to this channel. Legacy messages (channelId === null) only show in
  // the default channel so nothing silently vanishes after the migration.
  const messages = channelId
    ? allMessages.filter((m) => m.channelId === channelId || (isDefaultChannel && !m.channelId))
    : allMessages
  const members = useServersStore((s) => s.serverMembers[server.id] || [])
  const sendMessage = useServersStore((s) => s.sendServerMessage)
  const sendFileMessage = useServersStore((s) => s.sendServerFileMessage)
  const editServerMessage = useServersStore((s) => s.editServerMessage)
  const deleteServerMessage = useServersStore((s) => s.deleteServerMessage)
  const toggleServerReaction = useServersStore((s) => s.toggleServerReaction)
  const searchServerMessages = useServersStore((s) => s.searchServerMessages)
  const loadPinnedServerMessages = useServersStore((s) => s.loadPinnedServerMessages)
  const revealServerMessage = useServersStore((s) => s.revealServerMessage)
  const setServerMessagePinned = useServersStore((s) => s.setServerMessagePinned)
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfMember = members.find((m) => m.userId === selfId)
  const customRoles = useServersStore((s) => s.serverRoles[server.id]) ?? []
  const myPerms = selfMember
    ? effectivePermissions(selfMember.role, selfMember.roleIds, customRoles)
    : 0
  // Per-channel permission resolution — role overrides first, legacy gates
  // as fallback, host always allowed (see shared/permissions.ts).
  const layout = useServerLayout(server.id)
  const channelDef = channelId ? layout.channels.find((c) => c.id === channelId) : undefined
  const chanPerm = (key: ChannelPermKey): boolean =>
    channelDef
      ? resolveChannelPerm({
          tier: selfMember?.role ?? 'member',
          roleIds: selfMember?.roleIds ?? [],
          roles: customRoles,
          overrides: channelDef.overrides,
          minRole: channelDef.minRole,
          allowedRoleIds: channelDef.allowedRoleIds,
          sendRoleIds: channelDef.sendRoleIds,
          key
        })
      : hasPerm(myPerms, PERM[key as keyof typeof PERM] ?? 0)
  const isModerator =
    selfMember?.role === 'host' ||
    selfMember?.role === 'moderator' ||
    hasPerm(myPerms, PERM.manageMessages) ||
    chanPerm('manageMessages')
  const canPinMessages =
    selfMember?.role === 'host' ||
    selfMember?.role === 'moderator' ||
    hasPerm(myPerms, PERM.manageMessages)
  const canSend = chanPerm('sendMessages')
  const canAttach = chanPerm('attachFiles')

  const handleSearch = useCallback((options: MessageSearchOptions): Promise<Message[]> =>
    searchServerMessages(server.id, channelId, !!isDefaultChannel, options),
  [channelId, isDefaultChannel, searchServerMessages, server.id])

  const handleLoadPinned = useCallback((): Promise<Message[]> =>
    loadPinnedServerMessages(server.id, channelId, !!isDefaultChannel),
  [channelId, isDefaultChannel, loadPinnedServerMessages, server.id])

  const handleJumpToResult = useCallback(async (message: Message): Promise<void> => {
    await revealServerMessage(server.id, message.id, channelId, !!isDefaultChannel)
    setFocusMessageId(message.id)
  }, [channelId, isDefaultChannel, revealServerMessage, server.id])

  const handleTogglePin = useCallback(async (messageId: string, pinned: boolean): Promise<void> => {
    await setServerMessagePinned(server.id, messageId, pinned)
  }, [server.id, setServerMessagePinned])

  useEffect(() => {
    const scope = serverInboxScope(server.id, channelId)
    const markRead = (): void => {
      void markInboxScopeRead(scope)
      if (isDefaultChannel) void markInboxScopeRead(serverInboxScope(server.id, null))
    }
    markRead()
    window.addEventListener('focus', markRead)
    return () => window.removeEventListener('focus', markRead)
  }, [channelId, isDefaultChannel, markInboxScopeRead, server.id])

  const inboxJumpRef = useRef<string | null>(null)
  useEffect(() => {
    const messageId = new URLSearchParams(location.search).get('message')
    if (!messageId || inboxJumpRef.current === messageId) return
    inboxJumpRef.current = messageId
    void revealServerMessage(server.id, messageId, channelId, !!isDefaultChannel).then(() => {
      setFocusMessageId(messageId)
      return markInboxMessageRead(messageId)
    }).catch(console.error)
  }, [channelId, inboxJumpRef, isDefaultChannel, location.search, markInboxMessageRead, revealServerMessage, server.id])

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
              <button
                onClick={() => setToolsMode((current) => current === 'search' ? null : 'search')}
                className={cn(
                  'mesh-icon-button mesh-icon-search h-8 w-8 rounded flex items-center justify-center transition-colors',
                  toolsMode === 'search' ? 'bg-mesh-bg-tertiary text-mesh-text-primary' : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary'
                )}
              >
                <Search className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
            <Tooltip content="Pinned Messages" side="bottom">
              <button
                onClick={() => setToolsMode((current) => current === 'pins' ? null : 'pins')}
                className={cn(
                  'mesh-icon-button h-8 w-8 rounded flex items-center justify-center transition-colors',
                  toolsMode === 'pins' ? 'bg-mesh-bg-tertiary text-mesh-green' : 'text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary'
                )}
              >
                <Pin className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
            <Tooltip content={showMembers ? 'Hide Members' : 'Show Members'} side="bottom">
              <button
                onClick={() => {
                  setToolsMode(null)
                  setShowMembers(!showMembers)
                }}
                className={cn(
                  "mesh-icon-button mesh-icon-users h-8 w-8 rounded flex items-center justify-center transition-colors",
                  showMembers && !toolsMode
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
          onTogglePin={handleTogglePin}
          onReply={setReplyTarget}
          canDeleteMessage={(msg) => msg.senderId === selfId || isModerator}
          canPinMessage={() => canPinMessages}
          focusMessageId={focusMessageId}
          onFocusConsumed={() => setFocusMessageId(null)}
        />

        {/* Input — real file attachments, relayed through the signaling host
            to every member (2 MB cap; see sendServerFileMessage). Send/attach
            are permission-gated per role. */}
        {canSend ? (
          <MessageInput
            recipientName={displayName}
            onSend={(content, replyTo) => {
              sendMessage(server.id, content, channelId ?? null, replyTo)
              setReplyTarget(null)
            }}
            onSendFile={canAttach ? (filePath) => {
              sendFileMessage(server.id, filePath, channelId ?? null)
              setReplyTarget(null)
            } : undefined}
            replyTo={replyTarget ? { messageId: replyTarget.id, senderName: replyTarget.senderName, content: replyTarget.content } : undefined}
            onCancelReply={() => setReplyTarget(null)}
          />
        ) : (
          <div className="shrink-0 px-4 pb-4 pt-1">
            <div className="flex items-center justify-center h-11 rounded-lg bg-mesh-bg-tertiary/60 border border-mesh-border/50 text-sm text-mesh-text-muted select-none">
              You don&apos;t have permission to send messages in this channel.
            </div>
          </div>
        )}
      </div>

      {/* Member list */}
      {toolsMode ? (
        <MessageToolsPanel
          mode={toolsMode}
          scopeLabel={`#${displayName}`}
          liveMessages={messages}
          canPin={canPinMessages}
          onModeChange={setToolsMode}
          onClose={() => setToolsMode(null)}
          onSearch={handleSearch}
          onLoadPinned={handleLoadPinned}
          onJump={handleJumpToResult}
          onTogglePin={handleTogglePin}
        />
      ) : showMembers && <MemberListPanel serverId={server.id} members={members} />}
    </div>
  )
}

export { ServerTextChannel }
