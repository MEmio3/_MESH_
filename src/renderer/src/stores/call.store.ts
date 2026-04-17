/**
 * 1-to-1 call state machine.
 *
 * Flow:
 *   A clicks Phone/Video → startOutgoing → emits call-invite → status 'outgoing'
 *   B receives call-invite → receiveIncoming → status 'incoming'
 *   B accepts → emits call-accept → joins DM signaling room → starts audio(+video) → status 'active'
 *   A receives call-accept (remoteAccepted) → joins DM room → starts audio(+video) → status 'active'
 *   Either end → emits call-end → stops media → status 'idle'
 *   B declines → emits call-reject → A status 'ended' briefly → 'idle'
 *
 * Media flows through the existing WebRTC peer connections established by the
 * signaling join-room / offer / answer plumbing (unchanged). We piggy-back on
 * the DM room (`dm:dm_<peerId>`) to share a peer connection with the other user.
 */

import { create } from 'zustand'
import { webrtcManager } from '@/lib/webrtc'
import { useIdentityStore } from './identity.store'

type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'active' | 'declined'

interface CallState {
  status: CallStatus
  peerId: string | null
  peerName: string | null
  kind: 'voice' | 'video'
  isMuted: boolean
  isCameraOn: boolean
  startedAt: number | null
  remoteStream: MediaStream | null
  localStream: MediaStream | null

  startOutgoing: (peerId: string, peerName: string, kind: 'voice' | 'video') => void
  receiveIncoming: (peerId: string, peerName: string, kind: 'voice' | 'video') => void
  accept: () => Promise<void>
  decline: () => void
  remoteAccepted: () => Promise<void>
  remoteRejected: () => void
  end: (notifyPeer?: boolean) => void
  toggleMute: () => void
  toggleCamera: () => Promise<void>
  _setRemoteStream: (stream: MediaStream | null) => void
}

function dmRoomFor(peerId: string): string {
  return `dm:dm_${peerId}`
}

function navigateToDm(peerId: string): void {
  // HashRouter route used throughout the app.
  const next = `/channels/@me/dm_${peerId}`
  if (window.location.hash !== `#${next}`) {
    window.location.hash = next
  }
}

async function startMedia(kind: 'voice' | 'video'): Promise<MediaStream> {
  const audio = await webrtcManager.startAudio()
  let video: MediaStream | null = null
  if (kind === 'video') {
    try {
      video = await webrtcManager.startVideo()
    } catch (err) {
      console.warn('Camera unavailable, continuing as voice-only:', err)
    }
  }
  const tracks = [...audio.getTracks(), ...(video ? video.getTracks() : [])]
  return new MediaStream(tracks)
}

export const useCallStore = create<CallState>((set, get) => ({
  status: 'idle',
  peerId: null,
  peerName: null,
  kind: 'voice',
  isMuted: false,
  isCameraOn: false,
  startedAt: null,
  remoteStream: null,
  localStream: null,

  startOutgoing: (peerId, peerName, kind) => {
    if (get().status !== 'idle') return
    set({
      status: 'outgoing',
      peerId,
      peerName,
      kind,
      isMuted: false,
      isCameraOn: kind === 'video',
      startedAt: null,
      remoteStream: null,
      localStream: null
    })
    window.api.signaling.emit('call-invite', peerId, { kind })
  },

  receiveIncoming: (peerId, peerName, kind) => {
    if (get().status !== 'idle') {
      // Already busy — auto-reject
      window.api.signaling.emit('call-reject', peerId)
      return
    }
    set({
      status: 'incoming',
      peerId,
      peerName,
      kind,
      isMuted: false,
      isCameraOn: kind === 'video',
      startedAt: null,
      remoteStream: null,
      localStream: null
    })
  },

  accept: async () => {
    const { peerId, kind, status } = get()
    if (!peerId || status !== 'incoming') return
    window.api.signaling.emit('call-accept', peerId)
    // Both peers must sit in the same signaling room so webrtc peer + offer
    // flow through the existing join-room / onUserJoined plumbing.
    navigateToDm(peerId)
    window.api.signaling.emit('join-room', dmRoomFor(peerId))
    try {
      const local = await startMedia(kind)
      set({ status: 'active', startedAt: Date.now(), localStream: local })
    } catch (err) {
      console.error('Failed to start call media:', err)
      get().end(true)
    }
  },

  decline: () => {
    const { peerId } = get()
    if (peerId) window.api.signaling.emit('call-reject', peerId)
    set({
      status: 'idle',
      peerId: null,
      peerName: null,
      startedAt: null,
      remoteStream: null,
      localStream: null,
      isMuted: false,
      isCameraOn: false
    })
  },

  remoteAccepted: async () => {
    const { peerId, kind, status } = get()
    if (!peerId || status !== 'outgoing') return
    navigateToDm(peerId)
    window.api.signaling.emit('join-room', dmRoomFor(peerId))
    try {
      const local = await startMedia(kind)
      set({ status: 'active', startedAt: Date.now(), localStream: local })
    } catch (err) {
      console.error('Failed to start call media:', err)
      get().end(true)
    }
  },

  remoteRejected: () => {
    set({ status: 'declined' })
    // Auto-clear after a short toast
    setTimeout(() => {
      if (useCallStore.getState().status === 'declined') {
        set({
          status: 'idle',
          peerId: null,
          peerName: null,
          startedAt: null,
          remoteStream: null,
          localStream: null,
          isMuted: false,
          isCameraOn: false
        })
      }
    }, 1800)
  },

  end: (notifyPeer = true) => {
    const { peerId, status } = get()
    if (status === 'idle') return
    if (notifyPeer && peerId) window.api.signaling.emit('call-end', peerId)
    try {
      webrtcManager.stopAudio()
      webrtcManager.stopVideo()
    } catch { /* ignore */ }
    set({
      status: 'idle',
      peerId: null,
      peerName: null,
      startedAt: null,
      remoteStream: null,
      localStream: null,
      isMuted: false,
      isCameraOn: false
    })
  },

  toggleMute: () => {
    const next = !get().isMuted
    webrtcManager.setAudioEnabled(!next)
    set({ isMuted: next })
  },

  toggleCamera: async () => {
    const { isCameraOn } = get()
    if (isCameraOn) {
      webrtcManager.stopVideo()
      set({ isCameraOn: false })
    } else {
      try {
        await webrtcManager.startVideo()
        set({ isCameraOn: true, kind: 'video' })
      } catch (err) {
        console.warn('Failed to start camera:', err)
      }
    }
  },

  _setRemoteStream: (stream) => set({ remoteStream: stream })
}))

// Compose with any prior onRemoteStream handler (voice.store also uses this)
// so that 1-to-1 DM calls route the peer stream into the call overlay.
const prevRemote = webrtcManager.onRemoteStream
webrtcManager.onRemoteStream = (userId, stream) => {
  try { prevRemote?.(userId, stream) } catch { /* ignore */ }
  const state = useCallStore.getState()
  if (state.peerId === userId && (state.status === 'active' || state.status === 'outgoing')) {
    state._setRemoteStream(stream)
  }
}

// Same trick for onPeerDisconnected — end the call if the remote peer drops.
const prevPeerDown = webrtcManager.onPeerDisconnected
webrtcManager.onPeerDisconnected = (userId) => {
  try { prevPeerDown?.(userId) } catch { /* ignore */ }
  const state = useCallStore.getState()
  if (state.peerId === userId && state.status === 'active') {
    state.end(false)
  }
}

// Silence unused-var on identity import when tree-shaking is aggressive.
void useIdentityStore
