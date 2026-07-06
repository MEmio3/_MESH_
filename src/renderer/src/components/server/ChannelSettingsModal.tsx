import { useState } from 'react'
import { Hash, Volume2, X, Slash, Check, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Slider } from '@/components/ui/Slider'
import { useChannelsStore, type Channel } from '@/stores/channels.store'
import { useServersStore } from '@/stores/servers.store'
import { resolveRoleNames } from '@/lib/roleNames'
import {
  VOICE_CHANNEL_PERMS,
  TEXT_CHANNEL_PERMS,
  type ChannelOverrides,
  type ChannelPermKey,
  type OverrideState
} from '../../../../shared/permissions'

/**
 * Per-channel settings. Overview holds the practical knobs (name, bitrate,
 * user limit); Permissions is a Discord-style override matrix — pick a role
 * (or @everyone) on the left, set each permission to deny / inherit / allow.
 * Roles decide everything; the owner always bypasses.
 */
function ChannelSettingsModal({
  serverId,
  channelId,
  onClose
}: {
  serverId: string
  channelId: string
  onClose: () => void
}): JSX.Element | null {
  // Always read the LIVE channel from the store so edits accumulate.
  const channel = useChannelsStore((s) =>
    s.byServer[serverId]?.channels.find((c) => c.id === channelId)
  )
  const renameChannel = useChannelsStore((s) => s.renameChannel)
  const updateChannelSettings = useChannelsStore((s) => s.updateChannelSettings)
  const setChannelOverrides = useChannelsStore((s) => s.setChannelOverrides)
  const roles = useServersStore((s) => s.serverRoles[serverId]) ?? []
  const server = useServersStore((s) => s.servers.find((sv) => sv.id === serverId))
  const labels = resolveRoleNames(server?.roleNames)

  const [tab, setTab] = useState<'overview' | 'permissions'>('overview')
  const [name, setName] = useState(channel?.name ?? '')
  const [customBitrate, setCustomBitrate] = useState(channel?.bitrateKbps !== null)
  const [bitrate, setBitrate] = useState(channel?.bitrateKbps ?? 64)
  const [userLimit, setUserLimit] = useState(channel?.userLimit ?? 0)
  const [saving, setSaving] = useState(false)
  // Which role's overrides are being edited; 'everyone' is the base row.
  const [target, setTarget] = useState<string>('everyone')

  if (!channel) return null
  const isVoice = channel.type === 'voice'
  const Icon = isVoice ? Volume2 : Hash
  const permList = isVoice ? VOICE_CHANNEL_PERMS : TEXT_CHANNEL_PERMS

  const overviewDirty =
    name.trim() !== channel.name ||
    (customBitrate ? bitrate : null) !== channel.bitrateKbps ||
    userLimit !== channel.userLimit

  const saveOverview = async (): Promise<void> => {
    setSaving(true)
    try {
      if (name.trim() && name.trim() !== channel.name) {
        await renameChannel(serverId, channel.id, name.trim())
      }
      if (isVoice) {
        await updateChannelSettings(serverId, channel.id, customBitrate ? bitrate : null, userLimit)
      }
    } finally {
      setSaving(false)
    }
  }

  const stateFor = (key: ChannelPermKey): OverrideState | undefined =>
    channel.overrides?.[target]?.[key]

  const setState = (key: ChannelPermKey, next: OverrideState | undefined): void => {
    // Deep-copy, mutate, prune empties, persist. null clears the column.
    const draft: ChannelOverrides = JSON.parse(JSON.stringify(channel.overrides ?? {}))
    if (!draft[target]) draft[target] = {}
    if (next === undefined) delete draft[target][key]
    else draft[target][key] = next
    if (Object.keys(draft[target]).length === 0) delete draft[target]
    setChannelOverrides(serverId, channel.id, Object.keys(draft).length > 0 ? draft : null)
  }

  /** Count of overrides a role target carries (for the dot in the list). */
  const touchCount = (id: string): number =>
    Object.keys(channel.overrides?.[id] ?? {}).length

  return (
    <Modal isOpen onClose={onClose} title={`${isVoice ? 'Voice' : 'Text'} Channel — ${channel.name}`}>
      <div className="flex flex-col gap-4 max-h-[68vh]">
        {/* Tabs */}
        <div className="flex items-center gap-5 border-b border-mesh-border text-sm shrink-0">
          {([['overview', 'Overview'], ['permissions', 'Permissions']] as Array<['overview' | 'permissions', string]>).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'pb-2 -mb-px border-b-2 transition-colors',
                tab === key
                  ? 'border-mesh-green text-mesh-text-primary'
                  : 'border-transparent text-mesh-text-secondary hover:text-mesh-text-primary'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="flex flex-col gap-4 overflow-y-auto pr-1">
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1">
                Channel name
              </span>
              <div className="relative">
                <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-mesh-text-muted pointer-events-none" />
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="pl-8" />
              </div>
            </div>

            {isVoice && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary">
                      Bitrate
                    </span>
                    <label className="flex items-center gap-1.5 text-[11px] text-mesh-text-muted cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={customBitrate}
                        onChange={(e) => setCustomBitrate(e.target.checked)}
                        className="accent-[var(--color-mesh-green)]"
                      />
                      Custom
                    </label>
                  </div>
                  {customBitrate ? (
                    <>
                      <Slider value={bitrate} min={8} max={128} onChange={setBitrate} label={`${bitrate} kbps`} className="w-full" />
                      <p className="text-[11px] text-mesh-text-muted mt-1">
                        Caps each speaker&apos;s audio. 64 kbps is transparent for voice;
                        lower saves bandwidth on weak links, higher helps music.
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-mesh-text-muted">
                      Auto — the codec picks the best rate for the connection.
                    </p>
                  )}
                </div>

                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1">
                    User limit
                  </span>
                  <Slider value={userLimit} min={0} max={99} onChange={setUserLimit} label={userLimit === 0 ? '∞' : `${userLimit}`} className="w-full" />
                  <p className="text-[11px] text-mesh-text-muted mt-1">
                    Maximum members in this voice channel — enforced when joining.
                    The {labels.host} always gets in. 0 = unlimited.
                  </p>
                </div>
              </>
            )}

            <div className="flex justify-end pt-1">
              <Button size="sm" disabled={saving || !overviewDirty || !name.trim()} onClick={saveOverview}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        )}

        {tab === 'permissions' && (
          <div className="flex gap-3 min-h-0">
            {/* Role targets */}
            <div className="w-40 shrink-0 flex flex-col gap-1 overflow-y-auto border-r border-mesh-border pr-2">
              <span className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted">
                Roles
              </span>
              <button
                onClick={() => setTarget('everyone')}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left transition-colors min-w-0',
                  target === 'everyone'
                    ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
                    : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60'
                )}
              >
                <Users className="h-3.5 w-3.5 shrink-0 text-mesh-text-muted" />
                <span className="truncate flex-1">@everyone</span>
                {touchCount('everyone') > 0 && <span className="h-1.5 w-1.5 rounded-full bg-mesh-green shrink-0" />}
              </button>
              {roles.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setTarget(r.id)}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left transition-colors min-w-0',
                    target === r.id
                      ? 'bg-mesh-bg-tertiary text-mesh-text-primary'
                      : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60'
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                  <span className="truncate flex-1">{r.name}</span>
                  {touchCount(r.id) > 0 && <span className="h-1.5 w-1.5 rounded-full bg-mesh-green shrink-0" />}
                </button>
              ))}
              {roles.length === 0 && (
                <p className="px-1 text-[10px] text-mesh-text-muted leading-snug">
                  Create roles in Server Settings → Roles to grant per-role
                  overrides here.
                </p>
              )}
            </div>

            {/* Override matrix */}
            <div className="flex-1 min-w-0 overflow-y-auto pr-1">
              <p className="text-[11px] text-mesh-text-muted mb-2 leading-snug">
                <X className="inline h-3 w-3 text-mesh-danger -mt-0.5" /> deny ·{' '}
                <Slash className="inline h-3 w-3 -mt-0.5" /> inherit from roles ·{' '}
                <Check className="inline h-3 w-3 text-mesh-green -mt-0.5" /> allow.
                The {labels.host} always has every permission.
              </p>
              <div className="flex flex-col rounded-lg border border-mesh-border divide-y divide-mesh-border/60">
                {permList.map((perm) => {
                  const state = stateFor(perm.key)
                  return (
                    <div key={perm.key} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <span className="block text-[13px] text-mesh-text-primary">{perm.label}</span>
                        <span className="block text-[11px] text-mesh-text-muted leading-snug">{perm.description}</span>
                      </div>
                      <div className="flex rounded-md overflow-hidden border border-mesh-border shrink-0 mt-0.5">
                        <TriButton
                          active={state === 'deny'}
                          activeClass="bg-mesh-danger text-white"
                          title="Deny"
                          onClick={() => setState(perm.key, state === 'deny' ? undefined : 'deny')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </TriButton>
                        <TriButton
                          active={state === undefined}
                          activeClass="bg-mesh-bg-hover text-mesh-text-primary"
                          title="Inherit (use server-level roles)"
                          onClick={() => setState(perm.key, undefined)}
                        >
                          <Slash className="h-3.5 w-3.5" />
                        </TriButton>
                        <TriButton
                          active={state === 'allow'}
                          activeClass="bg-mesh-green text-white"
                          title="Allow"
                          onClick={() => setState(perm.key, state === 'allow' ? undefined : 'allow')}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </TriButton>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-mesh-text-muted mt-2 leading-snug">
                Changes apply instantly and sync to every member. Denying View
                Channel for @everyone and allowing it for specific roles makes
                this channel private to those roles.
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function TriButton({
  active,
  activeClass,
  title,
  onClick,
  children
}: {
  active: boolean
  activeClass: string
  title: string
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'h-7 w-8 flex items-center justify-center transition-colors',
        active ? activeClass : 'bg-mesh-bg-secondary text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary'
      )}
    >
      {children}
    </button>
  )
}

export { ChannelSettingsModal }
