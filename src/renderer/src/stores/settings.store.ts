import { create } from 'zustand'
import { webrtcManager } from '@/lib/webrtc'
import { applyTheme, isThemeId, DEFAULT_THEME, type ThemeId } from '@/lib/themes'

/**
 * Apply ICE configuration to the WebRTC manager based on user settings.
 *
 * Relay sources (deduped, in priority order):
 *   1. Live registry on the signaling server (`/get-relays`) — this is how
 *      peers discover each other's relays; the old code never queried it,
 *      so relays were never actually shared across the mesh.
 *   2. Local DB rows (our own hosted relay + previously known ones).
 *   3. Manually-entered custom relay addresses (no credentials).
 *
 * Every relay contributes a `stun:` entry as well — a TURN server answers
 * STUN for free, and srflx candidates (hole punching) are what let peers on
 * different subnets or behind the same CGNAT connect WITHOUT relaying any
 * media. These are friend-run relays, not third-party servers, so this
 * costs zero privacy. Strategies:
 *   - p2p-first:      STUN only (hole punching, never relays media).
 *   - relay-fallback: STUN + authenticated TURN, transport 'all'.
 *   - relay-only:     same servers, transport 'relay' (force TURN).
 */
async function applyIceConfig(network: NetworkSettings): Promise<void> {
  const strategy = network.preferredIceStrategy
  const signalingUrl = network.signalingUrl || 'http://localhost:3000'

  const [remote, local] = await Promise.all([
    window.api.relay.fetchRemote({ signalingUrl }).catch(() => []),
    window.api.db.relays.list().catch(() => [])
  ])

  const seen = new Set<string>()
  const iceServers: RTCIceServer[] = []

  const addRelayEntry = (address: string, username?: string | null, password?: string | null): void => {
    const addr = address.trim()
    if (!addr) return
    const bare = addr.replace(/^(turns?:|stun:)/, '')
    if (seen.has(bare)) return
    seen.add(bare)
    iceServers.push({ urls: `stun:${bare}` })
    if (strategy !== 'p2p-first') {
      const turnUrl = addr.startsWith('turn') ? addr : `turn:${bare}`
      if (username && password) {
        // Credentials are REQUIRED: the relay runs long-term auth, and an
        // unauthenticated turn: url is silently rejected (401) — the exact
        // bug that made every previous relay configuration a no-op.
        iceServers.push({ urls: turnUrl, username, credential: password })
      } else {
        iceServers.push({ urls: turnUrl })
      }
    }
  }

  for (const r of remote) addRelayEntry(r.address, r.credentials?.username, r.credentials?.password)
  for (const r of local) addRelayEntry(r.address, r.username, r.password)
  for (const addr of network.customRelays) addRelayEntry(addr)

  webrtcManager.setIceConfig(iceServers, strategy)
  console.log(`[ice] applied ${iceServers.length} ICE server entr${iceServers.length === 1 ? 'y' : 'ies'} (strategy: ${strategy})`)
}

interface AppearanceSettings {
  theme: ThemeId
  fontSize: number
  chatDensity: 'compact' | 'cozy' | 'default'
  messageGroupingMinutes: number
  animationsEnabled: boolean
}

interface NotificationSettings {
  enabled: boolean
  sound: boolean
  dmNotifications: boolean
  serverNotifications: boolean
  friendRequestNotifications: boolean
  callNotifications: boolean
  serverKickNotifications: boolean
}

function normalizePort(value: unknown): number {
  const raw = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(raw)) return 3000
  return Math.min(65535, Math.max(1, Math.floor(raw)))
}

export interface KnownNetwork {
  id: string
  name: string
  url: string
}

interface NetworkSettings {
  preferredIceStrategy: 'p2p-first' | 'relay-fallback' | 'relay-only'
  customRelays: string[]
  knownNetworks: KnownNetwork[]
  /** If true, this machine runs the embedded signaling server. */
  hostSignaling: boolean
  /** Primary host port — the one this client connects through. */
  hostPort: number
  /** Additional independent host ports to run alongside the primary
   *  (multi-hosting: separate isolated MESH networks on one machine). */
  extraHostPorts: number[]
  /** URL of the signaling server to connect to (own when hosting, else peer's). */
  signalingUrl: string
}

interface PrivacySettings {
  hideFromDiscovery: boolean
  invisibleMode: boolean
}

interface SettingsStore {
  appearance: AppearanceSettings
  notifications: NotificationSettings
  network: NetworkSettings
  privacy: PrivacySettings

  initialize: () => Promise<void>
  updateAppearance: (partial: Partial<AppearanceSettings>) => void
  updateNotifications: (partial: Partial<NotificationSettings>) => void
  updateNetwork: (partial: Partial<NetworkSettings>) => void
  updatePrivacy: (partial: Partial<PrivacySettings>) => void
  addCustomRelay: (address: string) => void
  removeCustomRelay: (address: string) => void
  /** Re-resolve relays + rebuild ICE config (e.g. after signaling reconnect). */
  reapplyIceConfig: () => Promise<void>
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: DEFAULT_THEME,
  fontSize: 14,
  chatDensity: 'default',
  messageGroupingMinutes: 5,
  animationsEnabled: true
}

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  sound: true,
  dmNotifications: true,
  serverNotifications: true,
  friendRequestNotifications: true,
  callNotifications: true,
  serverKickNotifications: true
}

const DEFAULT_NETWORK: NetworkSettings = {
  // relay-fallback by default: with no relays registered it behaves exactly
  // like p2p-first, but the moment anyone on the network contributes a relay
  // it starts working as a fallback — which is the entire point of relays.
  // The old p2p-first default meant relays were NEVER used unless the user
  // found and changed a buried setting.
  preferredIceStrategy: 'relay-fallback',
  customRelays: [],
  knownNetworks: [],
  hostSignaling: false,
  hostPort: 3000,
  extraHostPorts: [],
  signalingUrl: 'http://localhost:3000'
}

const DEFAULT_PRIVACY: PrivacySettings = {
  hideFromDiscovery: false,
  invisibleMode: false
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  appearance: { ...DEFAULT_APPEARANCE },
  notifications: { ...DEFAULT_NOTIFICATIONS },
  network: { ...DEFAULT_NETWORK },
  privacy: { ...DEFAULT_PRIVACY },

  initialize: async () => {
    const [appearanceRaw, notificationsRaw, networkRaw, privacyRaw] = await Promise.all([
      window.api.db.settings.get('appearance'),
      window.api.db.settings.get('notifications'),
      window.api.db.settings.get('network'),
      window.api.db.settings.get('privacy')
    ])

    const network = networkRaw ? { ...DEFAULT_NETWORK, ...JSON.parse(networkRaw) } : { ...DEFAULT_NETWORK }
    network.hostPort = normalizePort(network.hostPort)
    network.extraHostPorts = Array.isArray(network.extraHostPorts)
      ? [...new Set(network.extraHostPorts.map(normalizePort))].filter((p) => p !== network.hostPort)
      : []
    const privacy = privacyRaw ? { ...DEFAULT_PRIVACY, ...JSON.parse(privacyRaw) } : { ...DEFAULT_PRIVACY }

    const appearance: AppearanceSettings = appearanceRaw
      ? { ...DEFAULT_APPEARANCE, ...JSON.parse(appearanceRaw) }
      : { ...DEFAULT_APPEARANCE }
    if (!isThemeId(appearance.theme)) appearance.theme = DEFAULT_THEME

    set({
      appearance,
      notifications: notificationsRaw ? { ...DEFAULT_NOTIFICATIONS, ...JSON.parse(notificationsRaw) } : { ...DEFAULT_NOTIFICATIONS },
      network,
      privacy
    })

    // Skin the app before first paint settles — no animation on startup.
    applyTheme(appearance.theme, false, appearance.animationsEnabled)

    // Apply ICE config to WebRTC manager on load
    applyIceConfig(network)
  },

  updateAppearance: (partial) => {
    set((s) => {
      const updated = { ...s.appearance, ...partial }
      window.api.db.settings.set('appearance', JSON.stringify(updated))
      // Live theme/motion switch with a colour cross-fade.
      const themeChanged = partial.theme && partial.theme !== s.appearance.theme
      const motionChanged = typeof partial.animationsEnabled === 'boolean' && partial.animationsEnabled !== s.appearance.animationsEnabled
      if (themeChanged || motionChanged) {
        applyTheme(updated.theme, Boolean(themeChanged), updated.animationsEnabled)
      }
      return { appearance: updated }
    })
  },

  updateNotifications: (partial) => {
    set((s) => {
      const updated = { ...s.notifications, ...partial }
      window.api.db.settings.set('notifications', JSON.stringify(updated))
      return { notifications: updated }
    })
  },

  updateNetwork: (partial) => {
    set((s) => {
      const updated = { ...s.network, ...partial }
      updated.hostPort = normalizePort(updated.hostPort)
      window.api.db.settings.set('network', JSON.stringify(updated))
      // Re-apply ICE config when the strategy (or relay list impact) changes
      applyIceConfig(updated)
      return { network: updated }
    })
  },

  updatePrivacy: (partial) => {
    set((s) => {
      const updated = { ...s.privacy, ...partial }
      window.api.db.settings.set('privacy', JSON.stringify(updated))
      return { privacy: updated }
    })
  },

  addCustomRelay: (address) => {
    set((s) => {
      const updated = { ...s.network, customRelays: [...s.network.customRelays, address] }
      window.api.db.settings.set('network', JSON.stringify(updated))
      applyIceConfig(updated)
      return { network: updated }
    })
  },

  removeCustomRelay: (address) => {
    set((s) => {
      const updated = { ...s.network, customRelays: s.network.customRelays.filter((r) => r !== address) }
      window.api.db.settings.set('network', JSON.stringify(updated))
      applyIceConfig(updated)
      return { network: updated }
    })
  },

  reapplyIceConfig: async () => {
    await applyIceConfig(get().network)
  }
}))
