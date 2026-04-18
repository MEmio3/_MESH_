import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Hash, Volume2, Plus, MicOff, Folder, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { NamePromptModal } from '@/components/modals/NamePromptModal'
import { Avatar } from '@/components/ui/Avatar'
import {
  useChannelsStore,
  useServerLayout,
  type Channel,
  type ChannelCategory
} from '@/stores/channels.store'
import { useVoiceStore } from '@/stores/voice.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAvatarStore } from '@/stores/avatar.store'

interface ChannelTreeProps {
  serverId: string
  canManage: boolean
  activeChannelId: string | null
  onSelectTextChannel: (channelId: string) => void
}

type ContextMenuState =
  | { kind: 'pane' }
  | { kind: 'category'; category: ChannelCategory }
  | { kind: 'channel'; channel: Channel }

interface MenuAnchor { x: number; y: number; state: ContextMenuState }

/**
 * Renders the category + channel tree for a server, including:
 * - right-click context menu (pane / category / channel) gated to admins,
 * - + button on category hover that opens a small "what kind?" popover,
 * - create / rename modals and a delete confirm.
 *
 * Presentational only — all mutations go through useChannelsStore and are
 * permission-checked in the main process too.
 */
export function ChannelTree({
  serverId,
  canManage,
  activeChannelId,
  onSelectTextChannel
}: ChannelTreeProps): JSX.Element {
  const navigate = useNavigate()
  const layout = useServerLayout(serverId)
  const load = useChannelsStore((s) => s.load)
  const createCategory = useChannelsStore((s) => s.createCategory)
  const createChannel = useChannelsStore((s) => s.createChannel)
  const renameChannel = useChannelsStore((s) => s.renameChannel)
  const renameCategory = useChannelsStore((s) => s.renameCategory)
  const deleteChannel = useChannelsStore((s) => s.deleteChannel)
  const deleteCategory = useChannelsStore((s) => s.deleteCategory)

  const isConnected = useVoiceStore((s) => s.isConnected)
  const currentServerId = useVoiceStore((s) => s.currentServerId)
  const currentChannelId = useVoiceStore((s) => s.currentChannelId)
  const participants = useVoiceStore((s) => s.participants)
  const streamingUsers = useVoiceStore((s) => s.streamingUsers)
  const joinRoom = useVoiceStore((s) => s.joinRoom)
  const selfId = useIdentityStore((s) => s.identity?.userId)
  const selfAvatar = useAvatarStore((s) => s.self)
  const avatarsByUser = useAvatarStore((s) => s.byUser)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const [addPopover, setAddPopover] = useState<{ categoryId: string | null; rect: DOMRect } | null>(null)

  // Modal state
  const [modal, setModal] = useState<
    | { kind: 'new-category' }
    | { kind: 'new-channel'; type: 'text' | 'voice'; categoryId: string | null }
    | { kind: 'rename-channel'; channel: Channel }
    | { kind: 'rename-category'; category: ChannelCategory }
    | { kind: 'delete-channel'; channel: Channel }
    | { kind: 'delete-category'; category: ChannelCategory }
    | null
  >(null)

  useEffect(() => { load(serverId) }, [serverId, load])

  const isVoiceHere = isConnected && currentServerId === serverId

  const { uncategorized, categoryBuckets } = useMemo(() => {
    const uncategorized = layout.channels.filter((c) => !c.categoryId)
    const categoryBuckets = layout.categories.map((cat) => ({
      category: cat,
      channels: layout.channels.filter((c) => c.categoryId === cat.id)
    }))
    return { uncategorized, categoryBuckets }
  }, [layout])

  // Close the menu / popover on outside click / Escape.
  useEffect(() => {
    function onDown(e: MouseEvent): void {
      setMenu(null)
      setAddPopover(null)
      void e
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { setMenu(null); setAddPopover(null) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function openMenuAt(e: React.MouseEvent, state: ContextMenuState): void {
    if (!canManage) return
    e.preventDefault()
    e.stopPropagation()
    setAddPopover(null)
    setMenu({ x: e.clientX, y: e.clientY, state })
  }

  function openAddPopover(e: React.MouseEvent, categoryId: string | null): void {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu(null)
    setAddPopover({ categoryId, rect })
  }

  function renderChannel(ch: Channel): JSX.Element {
    const isText = ch.type === 'text'
    const isActiveText = isText && activeChannelId === ch.id
    // A voice channel is "joined" only when we're connected to *this specific*
    // channel's room. Without this check, every voice channel in the server
    // would show the same participant list and look active.
    const isJoinedVoice = !isText && isVoiceHere && currentChannelId === ch.id
    const Icon = isText ? Hash : Volume2

    return (
      <div key={ch.id} className="group/channel">
        <button
          onClick={() => {
            if (isText) {
              onSelectTextChannel(ch.id)
            } else if (!isJoinedVoice) {
              // Either not in any voice channel, or in a different one — hop
              // into this channel's room (voice.store handles the switch).
              joinRoom(serverId, ch.id)
            }
          }}
          onContextMenu={(e) => openMenuAt(e, { kind: 'channel', channel: ch })}
          className={cn(
            'w-full flex items-center gap-2 pl-6 pr-2 py-1.5 rounded-md text-left transition-colors h-8',
            isActiveText || isJoinedVoice
              ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
              : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/50 hover:text-mesh-text-primary'
          )}
        >
          <Icon className={cn('h-4 w-4 shrink-0', isJoinedVoice ? 'text-mesh-green' : 'text-mesh-text-muted')} />
          <span className="text-sm truncate flex-1">{ch.name}</span>
        </button>

        {/* Voice participants rendered only under the channel we're actually in. */}
        {isJoinedVoice && participants.length > 0 && (
          <div className="flex flex-col gap-0.5 pl-10 mt-0.5">
            {participants.map((p) => {
              const isLive = streamingUsers.has(p.userId)
              return (
                <div key={p.userId} className="flex items-center gap-2 px-2 py-1 rounded text-mesh-text-secondary">
                  <Avatar fallback={p.username} size="xs" status="online" src={p.userId === selfId ? selfAvatar : avatarsByUser[p.userId]} />
                  <span className="text-xs text-mesh-text-muted truncate">{p.username}</span>
                  {isLive && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-sm bg-red-500 px-1 py-0.5 text-[9px] font-bold uppercase leading-none text-white">
                      <span className="h-1 w-1 rounded-full bg-white" />
                      Live
                    </span>
                  )}
                  {p.isMuted && !isLive && <MicOff className="h-3 w-3 text-red-400 shrink-0 ml-auto" />}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex-1 overflow-y-auto"
      onContextMenu={(e) => openMenuAt(e, { kind: 'pane' })}
    >
      <div className="flex flex-col gap-0.5 px-2 pt-3 pb-4 min-h-full">
        {/* Uncategorized channels first, no header. */}
        {uncategorized.length > 0 && (
          <div className="flex flex-col gap-0.5 mb-2">
            {uncategorized.map(renderChannel)}
          </div>
        )}

        {categoryBuckets.map(({ category, channels }) => {
          const isOpen = !collapsed[category.id]
          return (
            <div key={category.id} className="flex flex-col gap-0.5">
              <div className="flex items-center group px-1 pb-1.5 pt-3">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [category.id]: isOpen }))}
                  onContextMenu={(e) => openMenuAt(e, { kind: 'category', category })}
                  className="flex items-center gap-1.5 flex-1 text-left cursor-pointer"
                >
                  <ChevronDown className={cn('h-3 w-3 text-mesh-text-muted group-hover:text-mesh-text-secondary transition-transform', !isOpen && '-rotate-90')} />
                  <span className="text-[11px] font-semibold text-mesh-text-muted group-hover:text-mesh-text-secondary uppercase tracking-wide truncate">
                    {category.name}
                  </span>
                </button>
                {canManage && (
                  <button
                    onClick={(e) => openAddPopover(e, category.id)}
                    className="opacity-0 group-hover:opacity-100 h-5 w-5 rounded-sm flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors"
                    title="Create Channel"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {isOpen && channels.map(renderChannel)}
            </div>
          )
        })}

        {layout.categories.length === 0 && uncategorized.length === 0 && (
          <div className="px-2 py-4 text-xs text-mesh-text-muted">
            {canManage ? 'Right-click to create a category or channel.' : 'No channels yet.'}
          </div>
        )}
      </div>

      {/* ── Context menu ─────────────────────────────────────────────── */}
      {menu && canManage && createPortal(
        <div
          className="fixed z-[120] min-w-[180px] rounded-md bg-mesh-bg-elevated border border-mesh-border/60 shadow-2xl py-1 text-sm"
          style={{ top: menu.y, left: menu.x }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.state.kind === 'pane' && (
            <>
              <MenuItem icon={<Folder className="h-3.5 w-3.5" />} onClick={() => { setMenu(null); setModal({ kind: 'new-category' }) }}>
                Create Category
              </MenuItem>
              <MenuItem icon={<Hash className="h-3.5 w-3.5" />} onClick={() => { setMenu(null); setModal({ kind: 'new-channel', type: 'text', categoryId: null }) }}>
                Create Text Channel
              </MenuItem>
              <MenuItem icon={<Volume2 className="h-3.5 w-3.5" />} onClick={() => { setMenu(null); setModal({ kind: 'new-channel', type: 'voice', categoryId: null }) }}>
                Create Voice Channel
              </MenuItem>
            </>
          )}
          {menu.state.kind === 'category' && (
            <>
              <MenuItem icon={<Hash className="h-3.5 w-3.5" />} onClick={() => {
                const cat = (menu.state as { kind: 'category'; category: ChannelCategory }).category
                setMenu(null); setModal({ kind: 'new-channel', type: 'text', categoryId: cat.id })
              }}>
                Create Text Channel
              </MenuItem>
              <MenuItem icon={<Volume2 className="h-3.5 w-3.5" />} onClick={() => {
                const cat = (menu.state as { kind: 'category'; category: ChannelCategory }).category
                setMenu(null); setModal({ kind: 'new-channel', type: 'voice', categoryId: cat.id })
              }}>
                Create Voice Channel
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => {
                const cat = (menu.state as { kind: 'category'; category: ChannelCategory }).category
                setMenu(null); setModal({ kind: 'rename-category', category: cat })
              }}>
                Rename Category
              </MenuItem>
              <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => {
                const cat = (menu.state as { kind: 'category'; category: ChannelCategory }).category
                setMenu(null); setModal({ kind: 'delete-category', category: cat })
              }}>
                Delete Category
              </MenuItem>
            </>
          )}
          {menu.state.kind === 'channel' && (
            <>
              <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => {
                const ch = (menu.state as { kind: 'channel'; channel: Channel }).channel
                setMenu(null); setModal({ kind: 'rename-channel', channel: ch })
              }}>
                Rename Channel
              </MenuItem>
              <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => {
                const ch = (menu.state as { kind: 'channel'; channel: Channel }).channel
                setMenu(null); setModal({ kind: 'delete-channel', channel: ch })
              }}>
                Delete Channel
              </MenuItem>
            </>
          )}
        </div>,
        document.body
      )}

      {/* ── Add popover (from category + hover) ──────────────────────── */}
      {addPopover && canManage && createPortal(
        <div
          className="fixed z-[120] min-w-[180px] rounded-md bg-mesh-bg-elevated border border-mesh-border/60 shadow-2xl py-1 text-sm"
          style={{ top: addPopover.rect.bottom + 4, left: addPopover.rect.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuItem icon={<Hash className="h-3.5 w-3.5" />} onClick={() => {
            const ctx = addPopover
            setAddPopover(null)
            setModal({ kind: 'new-channel', type: 'text', categoryId: ctx.categoryId })
          }}>
            Text Channel
          </MenuItem>
          <MenuItem icon={<Volume2 className="h-3.5 w-3.5" />} onClick={() => {
            const ctx = addPopover
            setAddPopover(null)
            setModal({ kind: 'new-channel', type: 'voice', categoryId: ctx.categoryId })
          }}>
            Voice Channel
          </MenuItem>
        </div>,
        document.body
      )}

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {modal?.kind === 'new-category' && (
        <NamePromptModal
          isOpen
          onClose={() => setModal(null)}
          title="New Category"
          label="Category Name"
          placeholder="e.g. Gaming"
          submitLabel="Create"
          onSubmit={async (name) => { await createCategory(serverId, name) }}
        />
      )}
      {modal?.kind === 'new-channel' && (
        <NamePromptModal
          isOpen
          onClose={() => setModal(null)}
          title={modal.type === 'text' ? 'New Text Channel' : 'New Voice Channel'}
          label="Channel Name"
          placeholder={modal.type === 'text' ? 'e.g. announcements' : 'e.g. lobby'}
          submitLabel="Create"
          onSubmit={async (name) => {
            const res = await createChannel(serverId, name, modal.type, modal.categoryId)
            if (res.success && res.channelId && modal.type === 'text') {
              onSelectTextChannel(res.channelId)
            }
          }}
        />
      )}
      {modal?.kind === 'rename-channel' && (
        <NamePromptModal
          isOpen
          onClose={() => setModal(null)}
          title="Rename Channel"
          label="Channel Name"
          initialValue={modal.channel.name}
          submitLabel="Save"
          onSubmit={async (name) => { await renameChannel(serverId, modal.channel.id, name) }}
        />
      )}
      {modal?.kind === 'rename-category' && (
        <NamePromptModal
          isOpen
          onClose={() => setModal(null)}
          title="Rename Category"
          label="Category Name"
          initialValue={modal.category.name}
          submitLabel="Save"
          onSubmit={async (name) => { await renameCategory(serverId, modal.category.id, name) }}
        />
      )}
      {modal?.kind === 'delete-channel' && (
        <ConfirmDeleteModal
          title="Delete Channel"
          description={`Delete #${modal.channel.name}? Messages in this channel will be lost.`}
          onCancel={() => setModal(null)}
          onConfirm={async () => {
            const ch = modal.channel
            await deleteChannel(serverId, ch.id)
            setModal(null)
            // If the active text channel was just deleted, drop selection so
            // the parent can route to a fallback.
            if (ch.type === 'text' && activeChannelId === ch.id) {
              navigate(`/channels/${serverId}`)
            }
          }}
        />
      )}
      {modal?.kind === 'delete-category' && (
        <ConfirmDeleteModal
          title="Delete Category"
          description={`Delete "${modal.category.name}"? Channels inside will be moved to uncategorized.`}
          onCancel={() => setModal(null)}
          onConfirm={async () => {
            await deleteCategory(serverId, modal.category.id)
            setModal(null)
          }}
        />
      )}
    </div>
  )
}

function MenuItem({
  icon, children, onClick, danger = false
}: {
  icon?: JSX.Element
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500 hover:text-white'
          : 'text-mesh-text-primary hover:bg-mesh-green hover:text-white'
      )}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="truncate">{children}</span>
    </button>
  )
}

function MenuSeparator(): JSX.Element {
  return <div className="h-px bg-mesh-border/50 my-1 mx-2" />
}

function ConfirmDeleteModal({
  title, description, onCancel, onConfirm
}: {
  title: string
  description: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Modal isOpen onClose={onCancel} title={title}>
      <p className="text-sm text-mesh-text-secondary mb-4">{description}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button
          className="bg-red-500 hover:bg-red-600 text-white"
          disabled={busy}
          onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false) } }}
        >
          Delete
        </Button>
      </div>
    </Modal>
  )
}

