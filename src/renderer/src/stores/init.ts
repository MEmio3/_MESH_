import { useFriendsStore } from './friends.store'
import { useMessagesStore } from './messages.store'
import { useServersStore } from './servers.store'
import { useSettingsStore } from './settings.store'
import { useInboxStore } from './inbox.store'

/**
 * Initialize all data stores from the database.
 * Called after identity is loaded (either on app start or after onboarding).
 */
export async function initializeAllStores(): Promise<void> {
  await Promise.all([
    useFriendsStore.getState().initialize(),
    useMessagesStore.getState().initialize(),
    useServersStore.getState().initialize(),
    useSettingsStore.getState().initialize(),
    useInboxStore.getState().initialize()
  ])
}
