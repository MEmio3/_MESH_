import { Check } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings.store'
import { SettingRow } from '@/components/settings/SettingRow'
import { Toggle } from '@/components/ui/Toggle'
import { Slider } from '@/components/ui/Slider'
import { THEMES } from '@/lib/themes'
import { cn } from '@/lib/utils'

const densityOptions = [
  { value: 'compact' as const, label: 'Compact' },
  { value: 'default' as const, label: 'Default' },
  { value: 'cozy' as const, label: 'Cozy' },
]

function AppearanceSettings(): JSX.Element {
  const appearance = useSettingsStore((s) => s.appearance)
  const updateAppearance = useSettingsStore((s) => s.updateAppearance)

  return (
    <div className="max-w-2xl mx-auto py-6 px-6">
      <h2 className="text-lg font-bold text-mesh-text-primary mb-6">Appearance</h2>

      {/* Theme */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-mesh-text-primary">Theme</h3>
        <p className="text-xs text-mesh-text-muted mt-0.5 mb-3">
          Pick a palette — it applies instantly across the whole app.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const active = appearance.theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => updateAppearance({ theme: t.id })}
                className={cn(
                  'relative rounded-xl border p-3 text-left transition-all',
                  active
                    ? 'border-mesh-green ring-1 ring-mesh-green/40'
                    : 'border-mesh-border hover:border-mesh-border-light hover:-translate-y-0.5'
                )}
                style={{ backgroundColor: t.swatch[0] }}
              >
                {/* Mini mockup: surface bar + accent dot rows */}
                <div className="rounded-md overflow-hidden mb-2.5 border border-white/5">
                  <div className="h-2" style={{ backgroundColor: t.swatch[1] }} />
                  <div className="p-1.5 flex flex-col gap-1" style={{ backgroundColor: t.swatch[0] }}>
                    <div className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.swatch[2] }} />
                      <span className="h-1 flex-1 rounded-full" style={{ backgroundColor: t.swatch[1] }} />
                    </div>
                    <span className="h-1 w-2/3 rounded-full" style={{ backgroundColor: t.swatch[1] }} />
                    <span className="h-1 w-1/2 rounded-full" style={{ backgroundColor: t.swatch[2], opacity: 0.7 }} />
                  </div>
                </div>
                <span className="block text-[13px] font-semibold text-white">{t.name}</span>
                <span className="block text-[10px] text-white/50 leading-tight">{t.tagline}</span>
                {active && (
                  <span className="absolute top-2 right-2 h-4.5 w-4.5 rounded-full flex items-center justify-center" style={{ backgroundColor: t.swatch[2] }}>
                    <Check className="h-3 w-3 text-white" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Font Size */}
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

      {/* Chat Density */}
      <SettingRow label="Chat Density" description="Control spacing between messages">
        <div className="flex rounded-lg overflow-hidden border border-mesh-border">
          {densityOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateAppearance({ chatDensity: opt.value })}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
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

      {/* Message Grouping */}
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

      {/* Animations */}
      <SettingRow label="Animations" description="Enable smooth transitions and motion effects" separator={false}>
        <Toggle
          checked={appearance.animationsEnabled}
          onChange={(v) => updateAppearance({ animationsEnabled: v })}
        />
      </SettingRow>
    </div>
  )
}

export { AppearanceSettings }
