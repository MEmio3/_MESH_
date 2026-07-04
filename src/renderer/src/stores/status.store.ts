import { create } from 'zustand'
import { useIdentityStore } from './identity.store'
import { useFriendsStore } from './friends.store'
import { useSettingsStore } from './settings.store'

export type StatusValue = 'online' | 'idle' | 'offline'

const IDLE_MS = 5 * 60 * 1000 // 5 minutes

interface FriendStatus {
  status: StatusValue
  lastSeen: number
}

interface StatusStore {
  self: StatusValue
  friendStatuses: Record<string, FriendStatus>

  startTracking: () => () => void
  publishSelf: (status?: StatusValue) => void
  publishFriendsSubscription: () => void
  subscribe: () => () => void
  applyInvisibleChange: () => void
}

let idleTimer: ReturnType<typeof setTimeout> | null = null
let lastActivityAt = Date.now()

function clearIdleTimer(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

export const useStatusStore = create<StatusStore>((set, get) => ({
  self: 'online',
  friendStatuses: {},

  publishSelf: (status) => {
    const invisible = useSettingsStore.getState().privacy.invisibleMode
    const next: StatusValue = status ?? get().self
    set({ self: next })
    window.api.signaling.emit('status:update', { status: next, invisible })
  },

  publishFriendsSubscription: () => {
    const friends = useFriendsStore.getState().friends
    const ids = friends.map((f) => f.userId)
    window.api.signaling.emit('status:set-friends', ids)
  },

  applyInvisibleChange: () => {
    // Invisible toggle re-sends current status with new flag.
    get().publishSelf()
  },

  startTracking: () => {
    const onActivity = (): void => {
      lastActivityAt = Date.now()
      if (get().self === 'idle') get().publishSelf('online')
      clearIdleTimer()
      idleTimer = setTimeout(() => {
        if (Date.now() - lastActivityAt >= IDLE_MS) get().publishSelf('idle')
      }, IDLE_MS)
    }

    const onFocus = (): void => {
      if (get().self !== 'online') get().publishSelf('online')
      onActivity()
    }

    const onBlur = (): void => { /* idle timer continues running */ }

    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('mousemove', onActivity)
    window.addEventListener('keydown', onActivity)
    window.addEventListener('mousedown', onActivity)

    // Kick things off.
    get().publishSelf(document.hasFocus() ? 'online' : 'online')
    onActivity()

    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('mousedown', onActivity)
      clearIdleTimer()
    }
  },

  subscribe: () => {
    const unsubs: Array<() => void> = []

    unsubs.push(
      window.api.signaling.onStatusChanged((payload) => {
        const friends = useFriendsStore.getState().friends
        // Only accept status updates about known friends.
        if (!friends.some((f) => f.userId === payload.userId)) return
        set((s) => ({
          friendStatuses: {
            ...s.friendStatuses,
            [payload.userId]: { status: payload.status, lastSeen: payload.lastSeen }
          }
        }))
        // Persist lastSeen + status on the friend row.
        window.api.db.friends.updateStatus(payload.userId, payload.status)
        // Reflect in the in-memory friends list so the UI updates live.
        useFriendsStore.setState((fs) => ({
          friends: fs.friends.map((f) =>
            f.userId === payload.userId ? { ...f, status: payload.status, lastSeen: payload.lastSeen } : f
          )
        }))
      })
    )

    unsubs.push(
      window.api.signaling.onStatusSnapshot((list) => {
        const next: Record<string, FriendStatus> = { ...get().friendStatuses }
        for (const p of list) next[p.userId] = { status: p.status, lastSeen: p.lastSeen }
        set({ friendStatuses: next })
        for (const p of list) window.api.db.friends.updateStatus(p.userId, p.status)
        useFriendsStore.setState((fs) => ({
          friends: fs.friends.map((f) => {
            const s = list.find((p) => p.userId === f.userId)
            return s ? { ...f, status: s.status, lastSeen: s.lastSeen } : f
          })
        }))
      })
    )

    // When signaling reconnects, re-publish self + resubscribe to friends.
    unsubs.push(
      window.api.signaling.onConnected(() => {
        const identity = useIdentityStore.getState().identity
        if (!identity) return
        get().publishFriendsSubscription()
        get().publishSelf()
      })
    )

    // When OUR socket drops we can no longer see anyone's presence — showing
    // the last-known green dots would be lying. Downgrade everyone to
    // offline; the reconnect snapshot restores the truth.
    unsubs.push(
      window.api.signaling.onDisconnected(() => {
        set((s) => {
          const next: Record<string, FriendStatus> = {}
          for (const [id, st] of Object.entries(s.friendStatuses)) {
            next[id] = { status: 'offline', lastSeen: st.lastSeen }
          }
          return { friendStatuses: next }
        })
      })
    )

    // When the friends list changes (accepted friend, removed, etc.), refresh subscription.
    const friendsUnsub = useFriendsStore.subscribe((state, prev) => {
      if (state.friends.length !== prev.friends.length) {
        get().publishFriendsSubscription()
      }
    })
    unsubs.push(friendsUnsub)

    return () => { for (const u of unsubs) u() }
  }
}))
