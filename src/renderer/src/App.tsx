import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { WelcomePage } from '@/pages/welcome/WelcomePage'
import { FriendsPage } from '@/pages/friends/FriendsPage'
import { DmConversationPage } from '@/pages/dm/DmConversationPage'
import { ServerPage } from '@/pages/server/ServerPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useServersStore } from '@/stores/servers.store'
import { useDiscoveryStore } from '@/stores/discovery.store'
import { useStatusStore } from '@/stores/status.store'
import { useAvatarStore } from '@/stores/avatar.store'
import { useServerAvatarStore } from '@/stores/serverAvatar.store'
import { handleIncomingPeerMessage, useMessagesStore } from '@/stores/messages.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useCallStore } from '@/stores/call.store'
import { initializeAllStores } from '@/stores/init'
import { webrtcManager } from '@/lib/webrtc'
import { CallOverlay } from '@/components/call/CallOverlay'

function LoadingScreen(): JSX.Element {
  return (
    <div className="h-screen w-screen bg-mesh-bg-primary flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 rounded-full border-2 border-transparent border-t-mesh-green animate-spin" />
        <span className="text-sm text-mesh-text-muted">Loading MESH...</span>
      </div>
    </div>
  )
}

function AppRoot(): JSX.Element {
  const isOnboarded = useIdentityStore((s) => s.isOnboarded)

  if (!isOnboarded) {
    return <Navigate to="/welcome" replace />
  }

  return <Navigate to="/channels/@me" replace />
}

function App(): JSX.Element {
  const isLoading = useIdentityStore((s) => s.isLoading)

  // Route notification clicks to HashRouter (window is already focused by main).
  useEffect(() => {
    return window.api.notifications.onClicked(({ route }) => {
      if (route) window.location.hash = route
    })
  }, [])

  // Task 9: fallback signaling-relayed DM payloads (messages + delivery acks)
  // must still land in the messages store even when no DM page is mounted.
  useEffect(() => {
    return window.api.signaling.onDmMessage(async (fromUserId: string, message: string) => {
      if (await window.api.block.isBlocked({ userId: fromUserId })) return
      handleIncomingPeerMessage(fromUserId, message)
    })
  }, [])

  // Push our avatar to any peer the moment its data channel opens so profile
  // pictures light up without the user having to reupload. The receiver saves
  // the PNG to disk via `avatar:save-for-user`, so it also persists across
  // restarts on both ends.
  useEffect(() => {
    const prev = webrtcManager.onDataChannelReady
    webrtcManager.onDataChannelReady = (userId) => {
      try { prev?.(userId) } catch { /* ignore */ }
      useAvatarStore.getState().sendToPeer(userId).catch(() => {})
    }
    return () => { webrtcManager.onDataChannelReady = prev }
  }, [])

  // 1-to-1 call signaling bridge → call store.
  useEffect(() => {
    const offInvite = window.api.signaling.onCallInvite(async (fromUserId, callData) => {
      if (await window.api.block.isBlocked({ userId: fromUserId })) return
      const friend = useFriendsStore.getState().friends.find((f) => f.userId === fromUserId)
      const kind = ((callData as { kind?: 'voice' | 'video' } | null)?.kind) === 'video' ? 'video' : 'voice'
      useCallStore.getState().receiveIncoming(fromUserId, friend?.username || fromUserId, kind)
    })
    const offAccept = window.api.signaling.onCallAccept((fromUserId) => {
      const st = useCallStore.getState()
      if (st.peerId === fromUserId) st.remoteAccepted().catch(console.error)
    })
    const offReject = window.api.signaling.onCallReject((fromUserId) => {
      const st = useCallStore.getState()
      if (st.peerId === fromUserId) st.remoteRejected()
    })
    const offEnd = window.api.signaling.onCallEnd((fromUserId) => {
      const st = useCallStore.getState()
      if (st.peerId === fromUserId) st.end(false)
    })
    return () => { offInvite(); offAccept(); offReject(); offEnd() }
  }, [])

  // Feature 2 and 3: signaling fallback for DM edit/delete/reaction when no P2P channel exists.
  useEffect(() => {
    const offEdit = window.api.signaling.onDmEdit((_fromUserId, payload) => {
      useMessagesStore.getState().applyRemoteEdit(payload.messageId, payload.content, payload.editedAt)
    })
    const offDel = window.api.signaling.onDmDelete((_fromUserId, payload) => {
      useMessagesStore.getState().applyRemoteDelete(payload.messageId)
    })
    const offReact = window.api.signaling.onDmReaction((_fromUserId, payload) => {
      useMessagesStore.getState().applyRemoteReaction(
        payload.messageId, payload.emojiId, payload.userId, payload.add
      )
      window.api.reaction.applyDm({ ...payload }).catch(console.error)
    })
    return () => { offEdit(); offDel(); offReact() }
  }, [])

  useEffect(() => {
    let unsubscribeSignaling: (() => void) | null = null
    let unsubscribeServers: (() => void) | null = null
    let unsubscribeDiscovery: (() => void) | null = null
    let unsubscribeStatus: (() => void) | null = null
    let stopStatusTracking: (() => void) | null = null
    async function init(): Promise<void> {
      await useIdentityStore.getState().initialize()
      // If identity exists (onboarded), load all stores from DB
      if (useIdentityStore.getState().isOnboarded) {
        await initializeAllStores()
        await useAvatarStore.getState().initialize()
        await useServerAvatarStore.getState().initialize()
        // Subscribe to signaling events (friend requests + server events)
        unsubscribeSignaling = useFriendsStore.getState().subscribeToSignaling()
        unsubscribeServers = useServersStore.getState().subscribeToServerEvents()
        unsubscribeDiscovery = useDiscoveryStore.getState().subscribe()
        unsubscribeStatus = useStatusStore.getState().subscribe()
        // Auto-connect to signaling server so incoming events arrive.
        const identity = useIdentityStore.getState().identity
        if (identity) {
          // Pick the URL from the settings store (persisted in DB as `network`).
          // Falls back to localhost which the embedded host uses when enabled.
          const net = useSettingsStore.getState().network
          const signalingUrl = net.signalingUrl || 'http://localhost:3000'
          try {
            await window.api.signaling.connect(signalingUrl, identity.userId)
            // After connecting, re-register hosted servers + rejoin member servers.
            await window.api.server.reregisterMine({ selfUserId: identity.userId })
            // Publish presence + fetch nearby list.
            await useDiscoveryStore.getState().publishSelf()
            await useDiscoveryStore.getState().refresh()
            // Task 6: publish own status + subscribe to friend statuses.
            useStatusStore.getState().publishFriendsSubscription()
            useStatusStore.getState().publishSelf('online')
            stopStatusTracking = useStatusStore.getState().startTracking()
          } catch (err) {
            console.warn('Signaling connect failed:', err)
          }
        }
      }
    }
    init()
    return () => {
      if (unsubscribeSignaling) unsubscribeSignaling()
      if (unsubscribeServers) unsubscribeServers()
      if (unsubscribeDiscovery) unsubscribeDiscovery()
      if (unsubscribeStatus) unsubscribeStatus()
      if (stopStatusTracking) stopStatusTracking()
    }
  }, [])

  if (isLoading) {
    return <LoadingScreen />
  }

  return (
    <HashRouter>
      <CallOverlay />
      <Routes>
        {/* Root — redirect based on onboarding state */}
        <Route path="/" element={<AppRoot />} />

        {/* Welcome / Onboarding — full screen, no AppShell */}
        <Route path="/welcome" element={<WelcomePage />} />

        {/* App Shell wraps all main views */}
        <Route element={<AppShell />}>
          {/* Home / Friends */}
          <Route path="/channels/@me" element={<FriendsPage />} />

          {/* DM Conversation */}
          <Route path="/channels/@me/:dmId" element={<DmConversationPage />} />

          {/* Community Server (default + specific channel) */}
          <Route path="/channels/:serverId" element={<ServerPage />} />
          <Route path="/channels/:serverId/:channelId" element={<ServerPage />} />

          {/* Settings */}
          <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
          <Route path="/settings/:category" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
