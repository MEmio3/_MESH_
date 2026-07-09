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
 * Media is host-relayed through MeshMediaEngine. Both peers join one canonical
 * `call:<userA>:<userB>` room, and audio/video packets move over the active
 * signaling host instead of WebRTC.
 */

import { create } from 'zustand'
import { mediaEngine } from '@/lib/media-engine'
import { useIdentityStore } from './identity.store'
import { useAudioPrefsStore } from './audioPrefs.store'
import { useVoiceStore, type StreamQuality, type StreamSource } from './voice.store'
import {
  startIncomingRing,
  stopIncomingRing,
  playOutgoingDial,
  playCallConnect,
  playCallDisconnect,
  playCallReject,
  playStreamStart,
  playStreamStop
} from '@/lib/sounds'

type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'active' | 'declined'

interface CallState {
  status: CallStatus
  peerId: string | null
  peerName: string | null
  kind: 'voice' | 'video'
  isMuted: boolean
  isCameraOn: boolean
  isScreenSharing: boolean
  screenSourceLabel: string | null
  isLocalSpeaking: boolean
  isRemoteSpeaking: boolean
  startedAt: number | null
  remoteStream: MediaStream | null
  localStream: MediaStream | null
  /** Why the last outgoing call ended in the 'declined' state — shown in the
   *  overlay. Distinguishes a real decline from "no answer" / "unreachable". */
  declineReason: string | null

  // Selected input/output device ids (persisted to localStorage).
  micDeviceId: string | null
  cameraDeviceId: string | null
  speakerDeviceId: string | null

  startOutgoing: (peerId: string, peerName: string, kind: 'voice' | 'video') => void
  receiveIncoming: (peerId: string, peerName: string, kind: 'voice' | 'video') => void
  accept: () => Promise<void>
  decline: () => void
  remoteAccepted: () => Promise<void>
  remoteRejected: (reason?: string) => void
  /** Host reported the callee isn't reachable (offline / different host). */
  remoteUnreachable: (peerId: string) => void
  end: (notifyPeer?: boolean) => void
  toggleMute: () => void
  toggleCamera: () => Promise<void>
  startScreenShareFromSource: (source: StreamSource, quality: StreamQuality) => Promise<void>
  stopScreenShare: () => void
  setMicDevice: (deviceId: string | null) => Promise<void>
  setCameraDevice: (deviceId: string | null) => Promise<void>
  setSpeakerDevice: (deviceId: string | null) => void
  _setRemoteStream: (stream: MediaStream | null) => void
  _clearRemoteVideo: () => void
  _setLocalSpeaking: (speaking: boolean) => void
  _setRemoteSpeaking: (speaking: boolean) => void
}

/**
 * Canonical 1-to-1 call room. DM rooms are per-user (each peer's DM room is
 * named after the OTHER user), so calls need their own shared room.
 */
function callRoomFor(selfId: string, peerId: string): string {
  const [a, b] = [selfId, peerId].sort()
  return `call:${a}:${b}`
}

function leaveVoiceBeforeCall(): void {
  const voice = useVoiceStore.getState()
  if (voice.isConnected) voice.leaveRoom()
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

function resolveQuality(q: StreamQuality): { width: number; height: number; frameRate: number; bitrate: number } {
  return q === 'HD'
    ? { width: 1920, height: 1080, frameRate: 60, bitrate: 4_500_000 }
    : { width: 1280, height: 720, frameRate: 30, bitrate: 2_500_000 }
}

async function captureStreamSource(source: StreamSource, quality: StreamQuality): Promise<MediaStream> {
  const { width, height, frameRate } = resolveQuality(quality)
  if (source.kind === 'camera') {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: source.deviceId ? { deviceId: { exact: source.deviceId } } : true
    })
  }

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error - Electron desktop-capture constraint.
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.sourceId,
        maxWidth: width,
        maxHeight: height,
        maxFrameRate: frameRate
      }
    }
  })
}

const persisted = readPersistedDevices()

// Auto-give-up timer for an outgoing invite that never gets answered (e.g. the
// callee isn't on the same host, so the invite was never delivered).
let outgoingTimer: ReturnType<typeof setTimeout> | null = null
const clearOutgoingTimer = (): void => {
  if (outgoingTimer) {
    clearTimeout(outgoingTimer)
    outgoingTimer = null
  }
}

export const useCallStore = create<CallState>((set, get) => ({
  status: 'idle',
  peerId: null,
  peerName: null,
  kind: 'voice',
  isMuted: false,
  isCameraOn: false,
  isScreenSharing: false,
  screenSourceLabel: null,
  isLocalSpeaking: false,
  isRemoteSpeaking: false,
  startedAt: null,
  remoteStream: null,
  localStream: null,
  declineReason: null,
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
      isScreenSharing: false,
      screenSourceLabel: null,
      isLocalSpeaking: false,
      isRemoteSpeaking: false,
      startedAt: null,
      remoteStream: null,
      localStream: null
    })
    window.api.signaling.emit('call-invite', peerId, { kind })
    playOutgoingDial()
    // Calls only work between two people on the SAME host — the invite is
    // relayed via userSockets on the host and simply doesn't reach anyone
    // who isn't connected to it. Rather than ring forever, give up after 30s
    // (the callee never got it, or isn't reachable).
    if (outgoingTimer) clearTimeout(outgoingTimer)
    outgoingTimer = setTimeout(() => {
      const st = get()
      if (st.status === 'outgoing' && st.peerId === peerId) {
        st.remoteRejected(`${peerName} didn't answer.`)
      }
    }, 30_000)
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
      isScreenSharing: false,
      screenSourceLabel: null,
      isLocalSpeaking: false,
      isRemoteSpeaking: false,
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
    leaveVoiceBeforeCall()
    window.api.signaling.emit('call-accept', peerId)
    navigateToDm(peerId)
    try {
      const prefs = useAudioPrefsStore.getState()
      mediaEngine.setInputGain(prefs.inputVolume / 100)
      const { cameraDeviceId } = get()
      const local = await startMedia(kind, prefs.inputDeviceId, cameraDeviceId)
      const cameraOn = local.getVideoTracks().some((t) => t.readyState === 'live')
      set({ status: 'active', startedAt: Date.now(), localStream: local, isCameraOn: cameraOn, isScreenSharing: false, screenSourceLabel: null })
      // Both peers sit in the SAME signaling room; the host relays media
      // packets between everyone in it.
      const room = callRoomFor(selfId, peerId)
      mediaEngine.joinRoom(room)
      window.api.signaling.emit('join-room', room)
      window.api.signaling.emit('call-video-state', peerId, { enabled: cameraOn })
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
      isCameraOn: false,
      isScreenSharing: false,
      screenSourceLabel: null,
      isLocalSpeaking: false,
      isRemoteSpeaking: false
    })
  },

  remoteAccepted: async () => {
    clearOutgoingTimer()
    const { peerId, kind, status } = get()
    if (!peerId || status !== 'outgoing') return
    const selfId = useIdentityStore.getState().identity?.userId
    if (!selfId) return
    playCallConnect()
    leaveVoiceBeforeCall()
    navigateToDm(peerId)
    try {
      const prefs = useAudioPrefsStore.getState()
      mediaEngine.setInputGain(prefs.inputVolume / 100)
      const { cameraDeviceId } = get()
      const local = await startMedia(kind, prefs.inputDeviceId, cameraDeviceId)
      const cameraOn = local.getVideoTracks().some((t) => t.readyState === 'live')
      set({ status: 'active', startedAt: Date.now(), localStream: local, isCameraOn: cameraOn, isScreenSharing: false, screenSourceLabel: null })
      const room = callRoomFor(selfId, peerId)
      mediaEngine.joinRoom(room)
      window.api.signaling.emit('join-room', room)
      window.api.signaling.emit('call-video-state', peerId, { enabled: cameraOn })
    } catch (err) {
      console.error('Failed to start call media:', err)
      get().end(true)
    }
  },

  remoteRejected: (reason = 'The call was declined.') => {
    clearOutgoingTimer()
    playCallReject()
    set({ status: 'declined', declineReason: reason })
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
          declineReason: null,
          isMuted: false,
          isCameraOn: false,
          isScreenSharing: false,
          screenSourceLabel: null,
          isLocalSpeaking: false,
          isRemoteSpeaking: false
        })
      }
    }, 2600)
  },

  remoteUnreachable: (unreachablePeerId) => {
    const { status, peerId, peerName } = get()
    // Only applies to a call we're currently placing to that peer.
    if (status !== 'outgoing' || peerId !== unreachablePeerId) return
    get().remoteRejected(`${peerName ?? 'They'} isn't reachable — you both need to be online on the same host to call.`)
  },

  end: (notifyPeer = true) => {
    clearOutgoingTimer()
    const { peerId, status } = get()
    if (status === 'idle') return
    const selfId = useIdentityStore.getState().identity?.userId
    const room = selfId && peerId ? callRoomFor(selfId, peerId) : null
    stopIncomingRing()
    // Only play disconnect if the call was actually active or outgoing.
    if (status === 'active' || status === 'outgoing') playCallDisconnect()
    if (notifyPeer && peerId) window.api.signaling.emit('call-end', peerId)
    try {
      get().localStream?.getTracks().forEach((t) => t.stop())
      mediaEngine.leaveRoom()
      if (room) window.api.signaling.emit('leave-room', room)
      else window.api.signaling.emit('leave-room')
    } catch { /* ignore */ }
    set({
      status: 'idle',
      peerId: null,
      peerName: null,
      startedAt: null,
      remoteStream: null,
      localStream: null,
      isMuted: false,
      isCameraOn: false,
      isScreenSharing: false,
      screenSourceLabel: null,
      isLocalSpeaking: false,
      isRemoteSpeaking: false
    })
  },

  toggleMute: () => {
    const next = !get().isMuted
    mediaEngine.setMicEnabled(!next)
    set({ isMuted: next, isLocalSpeaking: next ? false : get().isLocalSpeaking })
  },

  toggleCamera: async () => {
    const { isCameraOn, cameraDeviceId, localStream, peerId, status } = get()
    if (isCameraOn) {
      mediaEngine.stopVideo()
      localStream?.getVideoTracks().forEach((t) => t.stop())
      set({ isCameraOn: false, isScreenSharing: false, screenSourceLabel: null, localStream: new MediaStream() })
      if (peerId && status === 'active') {
        window.api.signaling.emit('call-video-state', peerId, { enabled: false })
      }
    } else {
      try {
        localStream?.getVideoTracks().forEach((t) => t.stop())
        const cam = await navigator.mediaDevices.getUserMedia({
          video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true
        })
        await mediaEngine.attachVideoStream(cam, 'camera', 2_500_000)
        set({ isCameraOn: true, isScreenSharing: false, screenSourceLabel: null, kind: 'video', localStream: cam })
        if (peerId && status === 'active') {
          window.api.signaling.emit('call-video-state', peerId, { enabled: true })
        }
      } catch (err) {
        console.warn('Failed to start camera:', err)
      }
    }
  },

  startScreenShareFromSource: async (source, quality) => {
    const { status, peerId, localStream } = get()
    if (status !== 'active') return
    try {
      const stream = await captureStreamSource(source, quality)
      const { bitrate } = resolveQuality(quality)
      mediaEngine.stopVideo()
      localStream?.getVideoTracks().forEach((t) => t.stop())
      await mediaEngine.attachVideoStream(stream, source.kind === 'camera' ? 'camera' : 'screen', bitrate)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        useCallStore.getState().stopScreenShare()
      })
      const isCameraSource = source.kind === 'camera'
      set({
        kind: 'video',
        isCameraOn: isCameraSource,
        isScreenSharing: !isCameraSource,
        screenSourceLabel: isCameraSource ? null : (source.label || 'Screen'),
        localStream: stream
      })
      if (peerId) window.api.signaling.emit('call-video-state', peerId, { enabled: true })
      playStreamStart()
    } catch (err) {
      console.warn('Failed to start call screen share:', err)
    }
  },

  stopScreenShare: () => {
    const { isScreenSharing, peerId, status, localStream } = get()
    if (!isScreenSharing) return
    mediaEngine.stopVideo()
    localStream?.getVideoTracks().forEach((t) => t.stop())
    set({
      isScreenSharing: false,
      isCameraOn: false,
      screenSourceLabel: null,
      localStream: new MediaStream()
    })
    if (peerId && status === 'active') window.api.signaling.emit('call-video-state', peerId, { enabled: false })
    playStreamStop()
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

  _setRemoteStream: (stream) => set({ remoteStream: stream }),
  _clearRemoteVideo: () => set((s) => {
    const existing = s.remoteStream
    if (!existing) return { remoteStream: null }
    for (const track of existing.getVideoTracks()) {
      try { track.stop() } catch { /* ignore */ }
    }
    const audioTracks = existing.getAudioTracks().filter((track) => track.readyState === 'live')
    return { remoteStream: audioTracks.length > 0 ? new MediaStream(audioTracks) : null }
  }),
  _setLocalSpeaking: (speaking) => set({ isLocalSpeaking: speaking }),
  _setRemoteSpeaking: (speaking) => set({ isRemoteSpeaking: speaking })
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

const prevCallLocalVoiceActivity = mediaEngine.onLocalVoiceActivity
mediaEngine.onLocalVoiceActivity = (active) => {
  try { prevCallLocalVoiceActivity?.(active) } catch { /* ignore */ }
  const state = useCallStore.getState()
  state._setLocalSpeaking(active && state.status === 'active' && !state.isMuted)
}

const prevCallRemoteVoiceActivity = mediaEngine.onParticipantVoiceActivity
mediaEngine.onParticipantVoiceActivity = (userId, active) => {
  try { prevCallRemoteVoiceActivity?.(userId, active) } catch { /* ignore */ }
  const state = useCallStore.getState()
  if (state.peerId === userId && state.status === 'active') {
    state._setRemoteSpeaking(active)
  }
}
