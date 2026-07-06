import { useState } from 'react'
import { Hash, Volume2, Search, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Slider } from '@/components/ui/Slider'
import { useChannelsStore, type Channel, type ChannelMinRole } from '@/stores/channels.store'
import { useServersStore } from '@/stores/servers.store'
import { resolveRoleNames } from '@/lib/roleNames'

/**
 * Per-channel settings, Discord-style. Every control is functional:
 *   - Overview: rename; voice channels get bitrate (applied to live audio
 *     senders) and a user limit (enforced by the signaling server at join).
 *   - Permissions: who can see/join (tier gate or role allow-list) and, for
 *     text channels, who can send messages.
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
  // Always read the LIVE channel from the store so toggles accumulate.
  const channel = useChannelsStore((s) =>
    s.byServer[serverId]?.channels.find((c) => c.id === channelId)
  )
  const renameChannel = useChannelsStore((s) => s.renameChannel)
  const updateChannelSettings = useChannelsStore((s) => s.updateChannelSettings)
  const setChannelAccess = useChannelsStore((s) => s.setChannelAccess)
  const setChannelRoles = useChannelsStore((s) => s.setChannelRoles)
  const setChannelSendRoles = useChannelsStore((s) => s.setChannelSendRoles)
  const roles = useServersStore((s) => s.serverRoles[serverId]) ?? []
  const server = useServersStore((s) => s.servers.find((sv) => sv.id === serverId))
  const labels = resolveRoleNames(server?.roleNames)

  const [tab, setTab] = useState<'overview' | 'permissions'>('overview')
  const [name, setName] = useState(channel?.name ?? '')
  const [customBitrate, setCustomBitrate] = useState(channel?.bitrateKbps !== null)
  const [bitrate, setBitrate] = useState(channel?.bitrateKbps ?? 64)
  const [userLimit, setUserLimit] = useState(channel?.userLimit ?? 0)
  const [saving, setSaving] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')

  if (!channel) return null
  const isVoice = channel.type === 'voice'
  const Icon = isVoice ? Volume2 : Hash

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

  const searched = roles.filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase()))
  const restrictedByRoles = !!channel.allowedRoleIds && channel.allowedRoleIds.length > 0

  return (
    <Modal isOpen onClose={onClose} title={`${isVoice ? 'Voice' : 'Text'} Channel — ${channel.name}`}>
      <div className="flex flex-col gap-4 max-h-[65vh] overflow-y-auto pr-1">
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
          <div className="flex flex-col gap-4">
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
                      <Slider
                        value={bitrate}
                        min={8}
                        max={128}
                        onChange={setBitrate}
                        label={`${bitrate} kbps`}
                        className="w-full"
                      />
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
                  <Slider
                    value={userLimit}
                    min={0}
                    max={99}
                    onChange={setUserLimit}
                    label={userLimit === 0 ? '∞' : `${userLimit}`}
                    className="w-full"
                  />
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
          <div className="flex flex-col gap-4">
            {/* Who can see / join */}
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1">
                {isVoice ? 'Who can see & join' : 'Who can see this channel'}
              </span>
              <div className="flex flex-col rounded-lg border border-mesh-border divide-y divide-mesh-border/60 mb-2">
                {([
                  ['member', 'Everyone'],
                  ['moderator', `${labels.moderator} & ${labels.host}`],
                  ['host', `${labels.host} only`]
                ] as Array<[ChannelMinRole, string]>).map(([tier, label]) => {
                  const active = !restrictedByRoles && (channel.minRole ?? 'member') === tier
                  return (
                    <button
                      key={tier}
                      onClick={() => {
                        setChannelRoles(serverId, channel.id, null)
                        setChannelAccess(serverId, channel.id, tier)
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-mesh-text-secondary hover:bg-mesh-bg-secondary hover:text-mesh-text-primary transition-colors"
                    >
                      <span className={cn(
                        'h-3.5 w-3.5 rounded-full border flex items-center justify-center shrink-0',
                        active ? 'border-mesh-green' : 'border-mesh-border-light'
                      )}>
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-mesh-green" />}
                      </span>
                      {label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-mesh-text-muted mb-2">
                Or restrict to specific roles — this overrides the tiers above.
                Hidden channels don&apos;t exist for anyone outside the list.
              </p>
              <RoleChecklist
                roles={searched}
                search={roleSearch}
                onSearch={setRoleSearch}
                isChecked={(id) => (channel.allowedRoleIds ?? []).includes(id)}
                onToggle={(id) => {
                  const current = channel.allowedRoleIds ?? []
                  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
                  setChannelRoles(serverId, channel.id, next.length > 0 ? next : null)
                }}
                emptyHint="No custom roles yet — create some in Server Settings → Roles."
              />
            </div>

            {/* Text: who can send */}
            {!isVoice && (
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-mesh-text-secondary mb-1">
                  Who can send messages
                </span>
                <p className="text-[11px] text-mesh-text-muted mb-2">
                  No roles selected = anyone with the Send Messages permission.
                  Selecting roles makes this read-only for everyone else —
                  perfect for an announcements channel.
                </p>
                <RoleChecklist
                  roles={searched}
                  search={roleSearch}
                  onSearch={setRoleSearch}
                  isChecked={(id) => (channel.sendRoleIds ?? []).includes(id)}
                  onToggle={(id) => {
                    const current = channel.sendRoleIds ?? []
                    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
                    setChannelSendRoles(serverId, channel.id, next.length > 0 ? next : null)
                  }}
                  emptyHint="No custom roles yet — create some in Server Settings → Roles."
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function RoleChecklist({
  roles,
  search,
  onSearch,
  isChecked,
  onToggle,
  emptyHint
}: {
  roles: Array<{ id: string; name: string; color: string }>
  search: string
  onSearch: (v: string) => void
  isChecked: (roleId: string) => boolean
  onToggle: (roleId: string) => void
  emptyHint: string
}): JSX.Element {
  return (
    <div className="rounded-lg border border-mesh-border">
      <div className="relative m-2">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-mesh-text-muted" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search roles"
          className="w-full h-7 pr-2 rounded bg-mesh-bg-secondary border border-mesh-border text-xs text-mesh-text-primary placeholder:text-mesh-text-muted focus:outline-none focus:border-mesh-green"
          style={{ paddingLeft: '1.6rem' }}
        />
      </div>
      <div className="max-h-40 overflow-y-auto pb-1">
        {roles.map((r) => {
          const has = isChecked(r.id)
          return (
            <button
              key={r.id}
              onClick={() => onToggle(r.id)}
              className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-[13px] text-mesh-text-secondary hover:bg-mesh-bg-secondary hover:text-mesh-text-primary transition-colors"
            >
              <span
                className={cn(
                  'h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                  has ? 'border-transparent' : 'border-mesh-border-light'
                )}
                style={has ? { backgroundColor: r.color } : undefined}
              >
                {has && <Check className="h-2.5 w-2.5 text-white" />}
              </span>
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
              <span className="truncate flex-1">{r.name}</span>
            </button>
          )
        })}
        {roles.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-mesh-text-muted">{emptyHint}</div>
        )}
      </div>
    </div>
  )
}

export { ChannelSettingsModal }
