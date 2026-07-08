import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SettingsCategory {
  id: string
  label: string
}

interface SettingsGroup {
  title: string
  items: SettingsCategory[]
}

const settingsGroups: SettingsGroup[] = [
  {
    title: 'User Settings',
    items: [
      { id: 'profile', label: 'My Profile' },
      { id: 'account', label: 'Account' },
      { id: 'privacy', label: 'Privacy' },
    ],
  },
  {
    title: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'notifications', label: 'Notifications' },
    ],
  },
  {
    title: 'Network',
    items: [
      { id: 'connection', label: 'Connection Details' },
      { id: 'relay', label: 'Relay Details' },
    ],
  },
  {
    title: 'MESH',
    items: [
      { id: 'about', label: 'About' },
    ],
  },
]

function SettingsSidePanel(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const activeCategory = location.pathname.split('/settings/')[1] || 'profile'

  return (
    <div className="flex flex-col">
      {/* Back Button */}
      <button
        onClick={() => navigate('/channels/@me')}
        className="flex items-center gap-2 h-12 px-4 text-mesh-text-secondary hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary/50 transition-colors border-b border-mesh-border/50"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-sm font-medium">Settings</span>
      </button>

      {/* Settings Groups */}
      <div className="flex flex-col px-2 pt-3 gap-4">
        {settingsGroups.map((group) => (
          <div key={group.title}>
            <div className="px-2 pb-1">
              <span className="text-[11px] font-semibold text-mesh-text-muted uppercase tracking-wide">
                {group.title}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const isActive = activeCategory === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(`/settings/${item.id}`)}
                    className={cn(
                      'flex items-center px-2 py-1.5 rounded-md text-sm text-left transition-colors duration-100',
                      isActive
                        ? 'bg-mesh-bg-tertiary text-mesh-text-primary border-l-2 border-mesh-green pl-1.5'
                        : 'text-mesh-text-secondary hover:bg-mesh-bg-tertiary/50 hover:text-mesh-text-primary'
                    )}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export { SettingsSidePanel }
