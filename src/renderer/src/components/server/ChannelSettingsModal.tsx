import { useState, type ReactNode } from 'react'
import {
  Check,
  Gauge,
  Hash,
  Shield,
  Slash,
  SlidersHorizontal,
  UserRoundCog,
  Users,
  Volume2,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Slider } from '@/components/ui/Slider'
import { Toggle } from '@/components/ui/Toggle'
import { useChannelsStore } from '@/stores/channels.store'
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
 * user limit); Permissions lets a role or @everyone override channel access.
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
  const [target, setTarget] = useState<string>('everyone')

  if (!channel) return null
  const isVoice = channel.type === 'voice'
  const Icon = isVoice ? Volume2 : Hash
  const permList = isVoice ? VOICE_CHANNEL_PERMS : TEXT_CHANNEL_PERMS
  const selectedRole = roles.find((role) => role.id === target)
  const selectedTargetName = target === 'everyone' ? '@everyone' : selectedRole?.name ?? 'Unknown role'
  const selectedTargetColor = target === 'everyone' ? 'var(--color-mesh-text-muted)' : selectedRole?.color
  const bitrateLabel = isVoice ? (customBitrate ? `${bitrate} kbps` : 'Auto') : 'N/A'
  const limitLabel = isVoice ? (userLimit === 0 ? 'Unlimited' : `${userLimit}`) : 'N/A'

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
    const draft: ChannelOverrides = JSON.parse(JSON.stringify(channel.overrides ?? {}))
    if (!draft[target]) draft[target] = {}
    if (next === undefined) delete draft[target][key]
    else draft[target][key] = next
    if (Object.keys(draft[target]).length === 0) delete draft[target]
    setChannelOverrides(serverId, channel.id, Object.keys(draft).length > 0 ? draft : null)
  }

  const touchCount = (id: string): number =>
    Object.keys(channel.overrides?.[id] ?? {}).length

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${isVoice ? 'Voice' : 'Text'} Channel - ${channel.name}`}
      className="max-w-2xl overflow-hidden"
      bodyClassName="px-0 pb-0"
    >
      <div className="flex max-h-[74vh] flex-col overflow-hidden border-t border-mesh-border/50">
        <div className="shrink-0 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-mesh-border/70 bg-mesh-bg-primary/40 p-1">
              {([
                ['overview', 'Overview', SlidersHorizontal],
                ['permissions', 'Permissions', Shield]
              ] as Array<['overview' | 'permissions', string, typeof SlidersHorizontal]>).map(([key, label, TabIcon]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition',
                    tab === key
                      ? 'bg-mesh-green text-white shadow-[0_8px_18px_rgba(35,165,89,0.24)]'
                      : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary'
                  )}
                >
                  <TabIcon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="hidden min-w-0 items-center gap-2 rounded-lg border border-mesh-border/60 bg-mesh-bg-tertiary/45 px-2.5 py-1.5 text-xs text-mesh-text-secondary sm:flex">
              <Icon className="h-3.5 w-3.5 text-mesh-text-muted" />
              <span className="truncate">{channel.name}</span>
            </div>
          </div>
        </div>

        {tab === 'overview' && (
          <div className="flex min-h-0 flex-col">
            <div className="grid gap-3 overflow-y-auto px-5 pb-4">
              <SettingCard
                icon={<Icon className="h-4 w-4" />}
                title="Channel name"
                meta={`${name.length}/40`}
              >
                <div className="relative">
                  <Icon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mesh-text-muted" />
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={40}
                    className="h-10 rounded-lg bg-mesh-bg-primary/55 pl-9"
                  />
                </div>
              </SettingCard>

              {isVoice && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingCard
                    icon={<Gauge className="h-4 w-4" />}
                    title="Bitrate"
                    meta={bitrateLabel}
                  >
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/35 px-3 py-2.5">
                      <div className="min-w-0">
                        <span className="block text-sm font-medium text-mesh-text-primary">Custom bitrate</span>
                        <span className="block truncate text-xs text-mesh-text-muted">{bitrateLabel}</span>
                      </div>
                      <Toggle checked={customBitrate} onChange={setCustomBitrate} />
                    </div>
                    {customBitrate && (
                      <div className="pt-3">
                        <Slider
                          value={bitrate}
                          min={8}
                          max={128}
                          onChange={setBitrate}
                          label={`${bitrate} kbps`}
                          className="w-full"
                        />
                      </div>
                    )}
                  </SettingCard>

                  <SettingCard
                    icon={<UserRoundCog className="h-4 w-4" />}
                    title="User limit"
                    meta={limitLabel}
                  >
                    <div className="rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/35 px-3 py-3">
                      <Slider
                        value={userLimit}
                        min={0}
                        max={99}
                        onChange={setUserLimit}
                        label={userLimit === 0 ? '∞' : `${userLimit}`}
                        className="w-full"
                      />
                      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                        <span className="text-mesh-text-muted">Host access</span>
                        <span className="rounded-full border border-mesh-green/25 bg-mesh-green/10 px-2 py-0.5 font-medium text-mesh-green">
                          Always allowed
                        </span>
                      </div>
                    </div>
                  </SettingCard>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-mesh-border/50 bg-mesh-bg-primary/30 px-5 py-3">
              <span className={cn(
                'text-xs',
                overviewDirty ? 'text-mesh-text-secondary' : 'text-mesh-text-muted'
              )}>
                {overviewDirty ? 'Unsaved changes' : 'No changes'}
              </span>
              <Button size="sm" disabled={saving || !overviewDirty || !name.trim()} onClick={saveOverview}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        )}

        {tab === 'permissions' && (
          <div className="grid min-h-[430px] grid-cols-[190px_minmax(0,1fr)] overflow-hidden border-t border-mesh-border/40">
            <aside className="min-h-0 overflow-y-auto border-r border-mesh-border/50 bg-mesh-bg-primary/25 px-3 py-4">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-mesh-text-muted">
                  Roles
                </span>
                <span className="rounded-full bg-mesh-bg-tertiary px-2 py-0.5 text-[10px] font-semibold text-mesh-text-muted">
                  {roles.length + 1}
                </span>
              </div>

              <RoleTargetButton
                active={target === 'everyone'}
                label="@everyone"
                icon={<Users className="h-3.5 w-3.5 text-mesh-text-muted" />}
                count={touchCount('everyone')}
                onClick={() => setTarget('everyone')}
              />

              <div className="mt-2 flex flex-col gap-1">
                {roles.map((role) => (
                  <RoleTargetButton
                    key={role.id}
                    active={target === role.id}
                    label={role.name}
                    color={role.color}
                    count={touchCount(role.id)}
                    onClick={() => setTarget(role.id)}
                  />
                ))}
              </div>

              {roles.length === 0 && (
                <p className="mt-3 rounded-lg border border-mesh-border/60 bg-mesh-bg-tertiary/35 px-2.5 py-2 text-xs leading-snug text-mesh-text-muted">
                  No custom roles yet.
                </p>
              )}
            </aside>

            <section className="min-w-0 overflow-y-auto bg-mesh-bg-secondary">
              <div className="sticky top-0 z-10 border-b border-mesh-border/50 bg-mesh-bg-secondary/95 px-4 py-3 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: selectedTargetColor }}
                      />
                      <h3 className="truncate text-sm font-semibold text-mesh-text-primary">
                        {selectedTargetName}
                      </h3>
                    </div>
                    <p className="mt-0.5 text-xs text-mesh-text-muted">
                      {touchCount(target)} overrides
                    </p>
                  </div>

                  <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-mesh-border/70 text-mesh-text-muted">
                    <LegendIcon title="Deny">
                      <X className="h-3.5 w-3.5 text-mesh-danger" />
                    </LegendIcon>
                    <LegendIcon title="Inherit">
                      <Slash className="h-3.5 w-3.5" />
                    </LegendIcon>
                    <LegendIcon title="Allow">
                      <Check className="h-3.5 w-3.5 text-mesh-green" />
                    </LegendIcon>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 p-4">
                {permList.map((perm) => {
                  const state = stateFor(perm.key)
                  return (
                    <div
                      key={perm.key}
                      className="flex items-center justify-between gap-4 rounded-xl border border-mesh-border/65 bg-mesh-bg-tertiary/35 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"
                    >
                      <div className="min-w-0">
                        <span className="block text-sm font-semibold text-mesh-text-primary">{perm.label}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-mesh-text-muted">{perm.description}</span>
                      </div>
                      <div className="grid shrink-0 grid-cols-3 overflow-hidden rounded-lg border border-mesh-border/70 bg-mesh-bg-primary/35">
                        <TriButton
                          active={state === 'deny'}
                          activeClass="bg-mesh-danger text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                          title="Deny"
                          onClick={() => setState(perm.key, state === 'deny' ? undefined : 'deny')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </TriButton>
                        <TriButton
                          active={state === undefined}
                          activeClass="bg-mesh-bg-hover text-mesh-text-primary"
                          title="Inherit"
                          onClick={() => setState(perm.key, undefined)}
                        >
                          <Slash className="h-3.5 w-3.5" />
                        </TriButton>
                        <TriButton
                          active={state === 'allow'}
                          activeClass="bg-mesh-green text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                          title="Allow"
                          onClick={() => setState(perm.key, state === 'allow' ? undefined : 'allow')}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </TriButton>
                      </div>
                    </div>
                  )
                })}

                <div className="rounded-xl border border-mesh-border/60 bg-mesh-bg-primary/35 px-3.5 py-3 text-xs text-mesh-text-muted">
                  {labels.host} always keeps every channel permission.
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </Modal>
  )
}

function SettingCard({
  icon,
  title,
  meta,
  children
}: {
  icon: ReactNode
  title: string
  meta?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="rounded-xl border border-mesh-border/70 bg-mesh-bg-tertiary/35 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-mesh-border/60 bg-mesh-bg-primary/45 text-mesh-green">
            {icon}
          </span>
          <span className="truncate text-sm font-semibold text-mesh-text-primary">{title}</span>
        </div>
        {meta && (
          <span className="shrink-0 rounded-full border border-mesh-border/60 bg-mesh-bg-primary/45 px-2 py-0.5 text-xs font-medium text-mesh-text-secondary">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

function RoleTargetButton({
  active,
  label,
  color,
  icon,
  count,
  onClick
}: {
  active: boolean
  label: string
  color?: string
  icon?: ReactNode
  count: number
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition',
        active
          ? 'bg-mesh-bg-tertiary text-mesh-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
          : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/60 hover:text-mesh-text-primary'
      )}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-mesh-green" />}
      {icon ?? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span className="shrink-0 rounded-full bg-mesh-green/15 px-1.5 py-0.5 text-[10px] font-semibold text-mesh-green">
          {count}
        </span>
      )}
    </button>
  )
}

function LegendIcon({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <span
      title={title}
      className="grid h-8 w-9 place-items-center border-r border-mesh-border/60 last:border-r-0"
    >
      {children}
    </span>
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
  children: ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'grid h-8 w-9 place-items-center border-r border-mesh-border/60 transition-colors last:border-r-0',
        active ? activeClass : 'bg-transparent text-mesh-text-muted hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary'
      )}
    >
      {children}
    </button>
  )
}

export { ChannelSettingsModal }
