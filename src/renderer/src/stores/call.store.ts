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
import { useAudioPrefsStore } from './audioPrefs.store'
import {
  startIncomingRing,
  stopIncomingRing,
  playOutgoingDial,
  playCallConnect,
  playCallDisconnect,
  playCallReject
} from '@/lib/sounds'

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

  // Selected input/output device ids (persisted to localStorage).
  micDeviceId: string | null
  cameraDeviceId: string | null
  speakerDeviceId: string | null

  startOutgoing: (peerId: string, peerName: string, kind: 'voice' | 'video') => void
  receiveIncoming: (peerId: string, peerName: string, kind: 'voice' | 'video') => void
  accept: () => Promise<void>
  decline: () => void
  remoteAccepted: () => Promise<void>
  remoteRejected: () => void
  end: (notifyPeer?: boolean) => void
  toggleMute: () => void
  toggleCamera: () => Promise<void>
  setMicDevice: (deviceId: string | null) => Promise<void>
  setCameraDevice: (deviceId: string | null) => Promise<void>
  setSpeakerDevice: (deviceId: string | null) => void
  _setRemoteStream: (stream: MediaStream | null) => void
}

/**
 * Canonical 1-to-1 call room. Both peers must land in the SAME signaling room
 * so the server's onUserJoined handler can pair them up for WebRTC offer/
 * answer exchange. DM rooms are per-user (each peer's DM room is named after
 * the OTHER user) so they cannot be reused here — they'd put the two peers
 * into different rooms and no peer connection would ever form.
 */
function callRoomFor(selfId: string, peerId: string): string {
  const [a, b] = [selfId, peerId].sort()
  return `call:${a}:${b}`
}

function navigateToDm(peerId: string): void {
  // HashRouter route used throughout the app.
  const next = `/channels/@me/dm_${peerId}`
  if (window.location.hash !== `#${next}`) {
    window.location.hash = next
  }
}

const LS_MIC = 'mesh.call.mic'
const LS_CAM = 'mesh.call.cam'
const LS_SPK = 'mesh.call.spk'

function readPersistedDevices(): { mic: string | null; cam: string | null; spk: string | null } {
  try {
    return {
      mic: localStorage.getItem(LS_MIC) || null,
      cam: localStorage.getItem(LS_CAM) || null,
      spk: localStorage.getItem(LS_SPK) || null
    }
  } catch { return { mic: null, cam: null, spk: null } }
}
function persistDevice(key: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(key, id); else localStorage.removeItem(key)
  } catch { /* ignore */ }
}

async function startMedia(
  kind: 'voice' | 'video',
  micDeviceId?: string | null,
  cameraDeviceId?: string | null
): Promise<MediaStream> {
  const audio = await webrtcManager.startAudio(micDeviceId || undefined)
  let video: MediaStream | null = null
  if (kind === 'video') {
    try {
      video = await webrtcManager.startVideo(cameraDeviceId || undefined)
    } catch (err) {
      console.warn('Camera unavailable, continuing as voice-only:', err)
    }
  }
  const tracks = [...audio.getTracks(), ...(video ? video.getTracks() : [])]
  return new MediaStream(tracks)
}

const persisted = readPersistedDevices()

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
  micDeviceId: persisted.mic,
  cameraDeviceId: persisted.cam,
  speakerDeviceId: persisted.spk,

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
    playOutgoingDial()
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
    startIncomingRing()
  },

  accept: async () => {
    const { peerId, kind, status } = get()
    if (!peerId || status !== 'incoming') return
    const selfId = useIdentityStore.getState().identity?.userId
    if (!selfId) return
    stopIncomingRing()
    playCallConnect()
    window.api.signaling.emit('call-accept', peerId)
    // Both peers must sit in the SAME signaling room so the server's
    // onUserJoined handler pairs them for offer/answer exchange.
    navigateToDm(peerId)
    window.api.signaling.emit('join-room', callRoomFor(selfId, peerId))
    try {
      const prefs = useAudioPrefsStore.getState()
      webrtcManager.setInputGain(prefs.inputVolume / 100)
      const { cameraDeviceId } = get()
      const local = await startMedia(kind, prefs.inputDeviceId, cameraDeviceId)
      set({ status: 'active', startedAt: Date.now(), localStream: local })
    } catch (err) {
      console.error('Failed to start call media:', err)
      get().end(true)
    }
  },

  decline: () => {
    const { peerId } = get()
    stopIncomingRing()
    playCallReject()
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
    const selfId = useIdentityStore.getState().identity?.userId
    if (!selfId) return
    playCallConnect()
    navigateToDm(peerId)
    window.api.signaling.emit('join-room', callRoomFor(selfId, peerId))
    try {
      const prefs = useAudioPrefsStore.getState()
      webrtcManager.setInputGain(prefs.inputVolume / 100)
      const { cameraDeviceId } = get()
      const local = await startMedia(kind, prefs.inputDeviceId, cameraDeviceId)
      set({ status: 'active', startedAt: Date.now(), localStream: local })
    } catch (err) {
      console.error('Failed to start call media:', err)
      get().end(true)
    }
  },

  remoteRejected: () => {
    playCallReject()
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
    stopIncomingRing()
    // Only play disconnect if the call was actually active or outgoing.
    if (status === 'active' || status === 'outgoing') playCallDisconnect()
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
    const { isCameraOn, cameraDeviceId } = get()
    if (isCameraOn) {
      webrtcManager.stopVideo()
      set({ isCameraOn: false })
    } else {
      try {
        await webrtcManager.startVideo(cameraDeviceId || undefined)
        set({ isCameraOn: true, kind: 'video' })
      } catch (err) {
        console.warn('Failed to start camera:', err)
      }
    }
  },

  setMicDevice: async (deviceId) => {
    persistDevice(LS_MIC, deviceId)
    set({ micDeviceId: deviceId })
    const { status, isMuted, localStream } = get()
    if (status !== 'active') return
    try {
      const nextAudio = await webrtcManager.replaceAudioDevice(deviceId || undefined)
      if (isMuted) webrtcManager.setAudioEnabled(false)
      const videoTracks = localStream?.getVideoTracks() ?? []
      set({ localStream: new MediaStream([...nextAudio.getTracks(), ...videoTracks]) })
    } catch (err) {
      console.error('Failed to switch microphone:', err)
    }
  },

  setCameraDevice: async (deviceId) => {
    persistDevice(LS_CAM, deviceId)
    set({ cameraDeviceId: deviceId })
    const { status, isCameraOn, localStream } = get()
    if (status !== 'active' || !isCameraOn) return
    try {
      const nextVideo = await webrtcManager.replaceVideoDevice(deviceId || undefined)
      const audioTracks = localStream?.getAudioTracks() ?? []
      set({ localStream: new MediaStream([...audioTracks, ...nextVideo.getTracks()]) })
    } catch (err) {
      console.error('Failed to switch camera:', err)
    }
  },

  setSpeakerDevice: (deviceId) => {
    persistDevice(LS_SPK, deviceId)
    set({ speakerDeviceId: deviceId })
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

