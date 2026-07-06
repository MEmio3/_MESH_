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
import { mediaEngine } from '@/lib/media-engine'
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
  // Mic capture + Opus encoding live inside the media engine; the returned
  // stream only carries the local camera track for the self-preview PiP.
  await mediaEngine.startMic(micDeviceId || undefined)
  if (kind === 'video') {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true
      })
      await mediaEngine.attachVideoStream(cam, 'camera', 2_500_000)
      return cam
    } catch (err) {
      console.warn('Camera unavailable, continuing as voice-only:', err)
    }
  }
  return new MediaStream()
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
    navigateToDm(peerId)
    try {
      const prefs = useAudioPrefsStore.getState()
      mediaEngine.setInputGain(prefs.inputVolume / 100)
      const { cameraDeviceId } = get()
      // IMPORTANT: acquire local media BEFORE joining the signaling room.
      // The initiator side of useSignaling.onUserJoined builds the peer
      // connection and immediately calls createOffer(). If local tracks are
      // not yet attached, the first SDP has no audio/video m-lines and the
      // renegotiation that follows startAudio() is unreliable on some
      // platforms — producing a silent call. Starting media first guarantees
      // that when our peer connection is created, the tracks get added
      // inside webrtc.ts (if (this.localAudioStream) pc.addTrack(...)) so
      // the very first offer already carries the tracks.
      const local = await startMedia(kind, prefs.inputDeviceId, cameraDeviceId)
      set({ status: 'active', startedAt: Date.now(), localStream: local })
      // Both peers sit in the SAME signaling room; the host relays media
      // packets between everyone in it.
      const room = callRoomFor(selfId, peerId)
      mediaEngine.joinRoom(room)
      window.api.signaling.emit('join-room', room)
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
    try {
      const prefs = useAudioPrefsStore.getState()
      mediaEngine.setInputGain(prefs.inputVolume / 100)
      const { cameraDeviceId } = get()
      // See note in accept(): acquire local media BEFORE joining the
      // signaling room so the first offer already carries tracks.
      const local = await startMedia(kind, prefs.inputDeviceId, cameraDeviceId)
      set({ status: 'active', startedAt: Date.now(), localStream: local })
      const room = callRoomFor(selfId, peerId)
      mediaEngine.joinRoom(room)
      window.api.signaling.emit('join-room', room)
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
      get().localStream?.getTracks().forEach((t) => t.stop())
      mediaEngine.leaveRoom()
      window.api.signaling.emit('leave-room')
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
    mediaEngine.setMicEnabled(!next)
    set({ isMuted: next })
  },

  toggleCamera: async () => {
    const { isCameraOn, cameraDeviceId, localStream } = get()
    if (isCameraOn) {
      mediaEngine.stopVideo()
      localStream?.getVideoTracks().forEach((t) => t.stop())
      set({ isCameraOn: false, localStream: new MediaStream() })
    } else {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true
        })
        await mediaEngine.attachVideoStream(cam, 'camera', 2_500_000)
        set({ isCameraOn: true, kind: 'video', localStream: cam })
      } catch (err) {
        console.warn('Failed to start camera:', err)
      }
    }
  },

  setMicDevice: async (deviceId) => {
    persistDevice(LS_MIC, deviceId)
    set({ micDeviceId: deviceId })
    const { status, isMuted } = get()
    if (status !== 'active') return
    try {
      await mediaEngine.replaceMicDevice(deviceId || undefined)
      if (isMuted) mediaEngine.setMicEnabled(false)
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
      mediaEngine.stopVideo()
      localStream?.getVideoTracks().forEach((t) => t.stop())
      const cam = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true
      })
      await mediaEngine.attachVideoStream(cam, 'camera', 2_500_000)
      set({ localStream: cam })
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
// NOTE: the engine may emit twice per peer (audio stream, then video canvas
// stream) — merge tracks so the overlay's <video>/<audio> get both.
const prevRemote = mediaEngine.onRemoteStream
mediaEngine.onRemoteStream = (userId, stream) => {
  try { prevRemote?.(userId, stream) } catch { /* ignore */ }
  const state = useCallStore.getState()
  if (state.peerId === userId && (state.status === 'active' || state.status === 'outgoing')) {
    const existing = state.remoteStream
    if (existing && existing !== stream) {
      const merged = new MediaStream()
      for (const t of [...existing.getTracks(), ...stream.getTracks()]) {
        if (t.readyState === 'live' && !merged.getTracks().some((m) => m.id === t.id)) {
          merged.addTrack(t)
        }
      }
      state._setRemoteStream(merged)
    } else {
      state._setRemoteStream(stream)
    }
  }
}

// End the call if the remote peer drops out of the room.
const prevPeerDown = mediaEngine.onParticipantLeft
mediaEngine.onParticipantLeft = (userId) => {
  try { prevPeerDown?.(userId) } catch { /* ignore */ }
  const state = useCallStore.getState()
  if (state.peerId === userId && state.status === 'active') {
    state.end(false)
  }
}

