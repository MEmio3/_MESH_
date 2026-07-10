import { useEffect, useMemo, useState } from 'react'
import { Check, Feather, Gem, Sparkles, Waves, Zap, type LucideIcon } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings.store'
import { SettingRow } from '@/components/settings/SettingRow'
import { Toggle } from '@/components/ui/Toggle'
import { Slider } from '@/components/ui/Slider'
import { THEMES, type MotionStyle, type ThemeId } from '@/lib/themes'
import { cn } from '@/lib/utils'

const densityOptions = [
  { value: 'compact' as const, label: 'Compact' },
  { value: 'default' as const, label: 'Default' },
  { value: 'cozy' as const, label: 'Cozy' },
]

const themeGroups: Array<{ id: string; label: string; themeIds: ThemeId[] }> = [
  {
    id: 'featured',
    label: 'Featured',
    themeIds: ['premium', 'rose-pine', 'rose-pine-moon', 'rose-pine-dawn']
  },
  {
    id: 'dark',
    label: 'Dark',
    themeIds: ['crimson', 'obsidian', 'midnight', 'aurora', 'ocean', 'violet', 'ember', 'carbon', 'xbox']
  },
  {
    id: 'vivid',
    label: 'Vivid',
    themeIds: ['sakura', 'cyber', 'forest', 'glacier', 'solar', 'orchid']
  }
]

const animationOptions: Array<{
  value: MotionStyle
  label: string
  hint: string
  Icon: LucideIcon
}> = [
  { value: 'smooth', label: 'Smooth', hint: 'Balanced', Icon: Waves },
  { value: 'luxe', label: 'Luxe', hint: 'Glint + glow', Icon: Gem },
  { value: 'snappy', label: 'Snappy', hint: 'Fast taps', Icon: Zap },
  { value: 'playful', label: 'Playful', hint: 'Bouncy icons', Icon: Sparkles },
  { value: 'calm', label: 'Calm', hint: 'Soft motion', Icon: Feather },
]

function groupForTheme(themeId: ThemeId): string {
  return themeGroups.find((group) => group.themeIds.includes(themeId))?.id ?? themeGroups[0].id
}

function themeById(themeId: ThemeId) {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0]
}

function isLightTheme(themeId: ThemeId): boolean {
  return themeId === 'rose-pine-dawn'
}

function AppearanceSettings(): JSX.Element {
  const appearance = useSettingsStore((s) => s.appearance)
  const updateAppearance = useSettingsStore((s) => s.updateAppearance)
  const [activeGroup, setActiveGroup] = useState(() => groupForTheme(appearance.theme))

  useEffect(() => {
    setActiveGroup(groupForTheme(appearance.theme))
  }, [appearance.theme])

  const activeTheme = useMemo(() => themeById(appearance.theme), [appearance.theme])
  const visibleThemes = useMemo(() => {
    const group = themeGroups.find((item) => item.id === activeGroup) ?? themeGroups[0]
    return group.themeIds.map(themeById)
  }, [activeGroup])

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h2 className="mb-6 text-lg font-bold text-mesh-text-primary">Appearance</h2>

      <section className="mb-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-mesh-text-primary">Theme</h3>
            <p className="mt-0.5 text-xs text-mesh-text-muted">
              Pick a palette - it applies instantly across the whole app.
            </p>
          </div>
          <span className="rounded-md border border-mesh-border bg-mesh-bg-secondary px-2 py-1 text-[11px] font-semibold text-mesh-text-secondary">
            {THEMES.length} total
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)]">
          <div
            className="rounded-lg border border-mesh-border p-3"
            style={{
              background: `linear-gradient(145deg, ${activeTheme.swatch[0]} 0%, ${activeTheme.swatch[1]} 70%, color-mix(in srgb, ${activeTheme.swatch[2]} 22%, ${activeTheme.swatch[0]}) 100%)`,
              boxShadow: `0 18px 48px -32px ${activeTheme.swatch[2]}`
            }}
          >
            <div className={cn('text-[10px] font-bold uppercase tracking-[0.14em]', isLightTheme(activeTheme.id) ? 'text-[#797593]' : 'text-white/45')}>
              Selected
            </div>
            <div className={cn('mt-3 text-base font-bold', isLightTheme(activeTheme.id) ? 'text-[#464261]' : 'text-white')}>
              {activeTheme.name}
            </div>
            <div className={cn('mt-1 text-xs leading-snug', isLightTheme(activeTheme.id) ? 'text-[#797593]' : 'text-white/58')}>
              {activeTheme.tagline}
            </div>
            <div className="mt-4 flex gap-1.5">
              {activeTheme.swatch.map((color) => (
                <span
                  key={color}
                  className="h-7 flex-1 rounded-md border border-white/10"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex rounded-lg border border-mesh-border bg-mesh-bg-secondary p-1">
              {themeGroups.map((group) => {
                const selected = group.id === activeGroup
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setActiveGroup(group.id)}
                    className={cn(
                      'mesh-pressable h-8 flex-1 rounded-md text-xs font-semibold transition-colors',
                      selected
                        ? 'bg-mesh-green text-white shadow-[0_8px_20px_-14px_var(--color-mesh-green)]'
                        : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary'
                    )}
                  >
                    {group.label}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 grid max-h-[246px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {visibleThemes.map((theme) => (
                <ThemeTile
                  key={theme.id}
                  theme={theme}
                  active={appearance.theme === theme.id}
                  onClick={() => updateAppearance({ theme: theme.id })}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <SettingRow label="Font Size" description="Adjust the base text size across the app">
        <Slider
          value={appearance.fontSize}
          min={12}
          max={18}
          onChange={(v) => updateAppearance({ fontSize: v })}
          label={`${appearance.fontSize}px`}
          className="w-48"
        />
      </SettingRow>

      <SettingRow label="Chat Density" description="Control spacing between messages">
        <div className="flex overflow-hidden rounded-lg border border-mesh-border">
          {densityOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateAppearance({ chatDensity: opt.value })}
              className={cn(
                'mesh-pressable px-3 py-1.5 text-xs font-medium transition-colors',
                appearance.chatDensity === opt.value
                  ? 'bg-mesh-green text-white'
                  : 'bg-mesh-bg-tertiary text-mesh-text-secondary hover:text-mesh-text-primary'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Message Grouping" description="Group consecutive messages from the same sender within this interval">
        <Slider
          value={appearance.messageGroupingMinutes}
          min={2}
          max={10}
          onChange={(v) => updateAppearance({ messageGroupingMinutes: v })}
          label={`${appearance.messageGroupingMinutes}m`}
          className="w-48"
        />
      </SettingRow>

      <section className="border-t border-mesh-border py-4">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-mesh-text-primary">Animations</h3>
            <p className="mt-0.5 text-xs text-mesh-text-muted">
              Choose the motion personality for buttons, icons, panels, and theme effects.
            </p>
          </div>
          <Toggle
            checked={appearance.animationsEnabled}
            onChange={(v) => updateAppearance({ animationsEnabled: v })}
          />
        </div>

        <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-5', !appearance.animationsEnabled && 'pointer-events-none opacity-45')}>
          {animationOptions.map(({ value, label, hint, Icon }) => {
            const active = appearance.animationStyle === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => updateAppearance({ animationStyle: value })}
                className={cn(
                  'mesh-pressable rounded-lg border p-2.5 text-left transition-all',
                  active
                    ? 'border-mesh-green bg-mesh-green/12 text-mesh-text-primary ring-1 ring-mesh-green/35'
                    : 'border-mesh-border bg-mesh-bg-secondary text-mesh-text-secondary hover:border-mesh-border-light hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary'
                )}
              >
                <span className="mb-2 flex items-center justify-between">
                  <Icon className="h-4 w-4 text-mesh-green" />
                  {active && <Check className="h-3.5 w-3.5 text-mesh-green" />}
                </span>
                <span className="block text-xs font-bold">{label}</span>
                <span className="mt-0.5 block text-[10px] leading-tight text-mesh-text-muted">{hint}</span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function ThemeTile({
  theme,
  active,
  onClick
}: {
  theme: (typeof THEMES)[number]
  active: boolean
  onClick: () => void
}): JSX.Element {
  const lightPreview = isLightTheme(theme.id)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'mesh-pressable relative min-h-[70px] rounded-lg border p-2.5 text-left transition-all',
        active
          ? 'border-mesh-green ring-1 ring-mesh-green/40'
          : 'border-mesh-border hover:border-mesh-border-light'
      )}
      style={{
        background: `linear-gradient(145deg, ${theme.swatch[0]} 0%, ${theme.swatch[1]} 72%, color-mix(in srgb, ${theme.swatch[2]} 16%, ${theme.swatch[0]}) 100%)`,
        boxShadow: active ? `0 0 22px -12px ${theme.swatch[2]}` : undefined
      }}
    >
      <div className="mb-2 flex h-5 items-center gap-1.5 rounded border border-white/5 px-1.5" style={{ backgroundColor: theme.swatch[0] }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: theme.swatch[2] }} />
        <span className="h-1 flex-1 rounded-full opacity-70" style={{ backgroundColor: theme.swatch[1] }} />
        <span className="h-1 w-10 rounded-full" style={{ background: `linear-gradient(90deg, ${theme.swatch[2]}, ${theme.swatch[1]})` }} />
      </div>
      <span className={cn('block text-[13px] font-semibold', lightPreview ? 'text-[#464261]' : 'text-white')}>
        {theme.name}
      </span>
      <span className={cn('block text-[10px] leading-tight', lightPreview ? 'text-[#797593]' : 'text-white/50')}>
        {theme.tagline}
      </span>
      {active && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: theme.swatch[2] }}>
          <Check className="h-3 w-3 text-white" />
        </span>
      )}
    </button>
  )
}

export { AppearanceSettings }
