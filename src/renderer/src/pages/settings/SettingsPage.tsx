import { useParams } from 'react-router-dom'
import { ProfileSettings } from './ProfileSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { NotificationSettings } from './NotificationSettings'
import { RelaySettings } from './RelaySettings'
import { NetworkSettings } from './NetworkSettings'
import { AboutPage } from './AboutPage'
import { PrivacySettings } from './PrivacySettings'
import { AccountSettings } from './AccountSettings'

const pages: Record<string, () => JSX.Element> = {
  profile: ProfileSettings,
  account: AccountSettings,
  privacy: PrivacySettings,
  appearance: AppearanceSettings,
  notifications: NotificationSettings,
  relay: RelaySettings,
  connection: NetworkSettings,
  about: AboutPage,
}

function SettingsPage(): JSX.Element {
  const { category } = useParams<{ category: string }>()
  const PageComponent = pages[category || 'profile'] || pages.profile

  return (
    <div className="h-full overflow-y-auto">
      <PageComponent />
    </div>
  )
}

export { SettingsPage }
