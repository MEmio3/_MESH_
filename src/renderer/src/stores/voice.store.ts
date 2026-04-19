import { create } from 'zustand'
import type { VoiceParticipant } from '@/types/server'
import { useIdentityStore } from './identity.store'
import { useAudioPrefsStore } from './audioPrefs.store'
import { webrtcManager } from '@/lib/webrtc'
import {
  playVoiceSelfJoin,
  playVoiceSelfLeave,
  playPeerJoinVoice,
  playPeerLeaveVoice,
  playMute,
  playUnmute,
  playDeafen,
  playUndeafen,
  playStreamStart,
  playStreamStop
} from '@/lib/sounds'

export type StreamQuality = 'SD' | 'HD'

export interface StreamSource {
  kind: 'screen' | 'window' | 'camera'
  sourceId?: string   // for screen/window (desktopCapturer source id)
  deviceId?: string   // for camera (mediaDevices deviceId)
  label?: string
}

interface VoiceStore {
  isConnected: boolean
  currentServerId: string | null
  /**
   * Which voice channel within the server is joined. Null for legacy/default
   * voice room (pre-channels) so rooms created before the Phase-2 schema
   * migration still connect into a shared bucket.
   */
  currentChannelId: string | null
  participants: VoiceParticipant[]
  remoteStreams: Map<string, MediaStream>
  streamingUsers: Set<string>   // userIds currently streaming video/screen
  localMediaStream: MediaStream | null // reactive handle to self-preview stream
  isMuted: boolean
  isDeafened: boolean
  isScreenSharing: boolean
  isCameraOn: boolean
  streamQuality: StreamQuality
  currentStreamSource: StreamSource | null
  // Transient picker state (UI reads this to open/tab the modal)
  pickerOpen: boolean
  pickerInitialTab: 'applications' | 'screens' | 'camera'

  // Full-screen stream viewer state — userId currently being watched, or null.
  viewingStreamUserId: string | null

  // Self-preview PiP visibility. Independent from whether you're actually streaming.
  // Toggled by the X button on the PiP; does NOT stop the stream.
  previewVisible: boolean

  joinRoom: (serverId: string, channelId?: string | null) => Promise<void>
  leaveRoom: () => void
  addParticipant: (participant: VoiceParticipant) => void
  removeParticipant: (userId: string) => void
  setRemoteStream: (userId: string, stream: MediaStream) => void
  toggleMute: () => void
  toggleDeafen: () => void

  // Streaming state
  setStreaming: (userId: string, streaming: boolean) => void
  setStreamQuality: (quality: StreamQuality) => void
  startStreamFromSource: (source: StreamSource, quality: StreamQuality) => Promise<void>
  stopStream: () => void
  openPicker: (tab?: 'applications' | 'screens' | 'camera') => void
  closePicker: () => void
  openStreamViewer: (userId: string) => void
  closeStreamViewer: () => void
  hidePreview: () => void
  showPreview: () => void
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  isConnected: false,
  currentServerId: null,
  currentChannelId: null,
  participants: [],
  remoteStreams: new Map(),
  streamingUsers: new Set(),
  localMediaStream: null,
  isMuted: false,
  isDeafened: false,
  isScreenSharing: false,
  isCameraOn: false,
  streamQuality: 'SD',
  currentStreamSource: null,
  pickerOpen: false,
  pickerInitialTab: 'applications',
  viewingStreamUserId: null,
  previewVisible: true,

  joinRoom: async (serverId, channelId) => {
    const nextChannelId = channelId ?? null
    const state = get()
    // No-op if already in this exact voice channel.
    if (state.isConnected && state.currentServerId === serverId && state.currentChannelId === nextChannelId) {
      return
    }

    // Switching within the same server? Hop rooms without tearing down audio.
    // We still need to drop remote peers (they're in the other room and will
    // not hear us) so `onPeerDisconnected` can clean them out of the list.
    const isSwitching = state.isConnected && state.currentServerId === serverId
    if (isSwitching) {
      webrtcManager.closeAll()
      window.api.signaling.emit('leave-room')
    } else if (state.isConnected) {
      // Joining a different server — do a full leave first.
      webrtcManager.stopAudio()
      webrtcManager.stopVideo()
      webrtcManager.stopScreenShare()
      webrtcManager.closeAll()
      window.api.signaling.emit('leave-room')
    }

    const identity = useIdentityStore.getState().identity
    const self: VoiceParticipant = {
      userId: identity?.userId || 'unknown',
      username: identity?.username || 'Unknown',
      avatarColor: identity?.avatarColor || null,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
      isScreenSharing: false,
      isCameraOn: false
    }
    set({
      isConnected: true,
      currentServerId: serverId,
      currentChannelId: nextChannelId,
      // Reset participants to just self when switching — remote peers in the
      // previous channel must not leak into the new one's sidebar list.
      participants: [self],
      remoteStreams: new Map(),
      streamingUsers: new Set()
    })

    if (!isSwitching) {
      try {
        // Respect the user's globally-selected mic + input volume.
        const prefs = useAudioPrefsStore.getState()
        webrtcManager.setInputGain(prefs.inputVolume / 100)
        await webrtcManager.startAudio(prefs.inputDeviceId || undefined)
      } catch (err) {
        console.error('Failed to start audio:', err)
      }
    }
    // Scope the room to server + channel so different voice channels are
    // separate rooms (users in #gaming don't hear users in #voice-lounge).
    // `legacy` bucket keeps pre-channels callers (ServerVoiceRoom without a
    // channelId) on a shared room so existing behavior is unchanged.
    const roomId = `voice:${serverId}:${nextChannelId ?? 'legacy'}`
    window.api.signaling.emit('join-room', roomId)
    // Only play the self-join chime on a fresh join; room-hopping within the
    // same server shouldn't ding twice.
    if (!isSwitching) playVoiceSelfJoin()
  },

  leaveRoom: () => {
    const wasConnected = get().isConnected
    webrtcManager.stopAudio()
    webrtcManager.stopVideo()
    webrtcManager.stopScreenShare()
    webrtcManager.closeAll()
    window.api.signaling.emit('leave-room')
    if (wasConnected) playVoiceSelfLeave()
    set({
      isConnected: false,
      currentServerId: null,
      currentChannelId: null,
      participants: [],
      remoteStreams: new Map(),
      streamingUsers: new Set(),
      localMediaStream: null,
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
      isCameraOn: false,
      currentStreamSource: null,
      pickerOpen: false,
      viewingStreamUserId: null,
      previewVisible: true
    })
  },

  addParticipant: (participant) => {
    set((s) => {
      if (s.participants.find((p) => p.userId === participant.userId)) return s
      return { participants: [...s.participants, participant] }
    })
  },

  removeParticipant: (userId) => {
    set((s) => {
      const remoteStreams = new Map(s.remoteStreams)
      remoteStreams.delete(userId)
      const streamingUsers = new Set(s.streamingUsers)
      streamingUsers.delete(userId)
      return {
        participants: s.participants.filter((p) => p.userId !== userId),
        remoteStreams,
        streamingUsers
      }
    })
  },

  setRemoteStream: (userId, stream) => {
    set((s) => {
      const remoteStreams = new Map(s.remoteStreams)
      remoteStreams.set(userId, stream)
      // If the stream has video tracks, mark the user as streaming
      const streamingUsers = new Set(s.streamingUsers)
      if (stream.getVideoTracks().length > 0) {
        streamingUsers.add(userId)
      }
      return { remoteStreams, streamingUsers }
    })
  },

  toggleMute: () => {
    const next = !get().isMuted
    webrtcManager.setAudioEnabled(!next)
    set({ isMuted: next })
    if (next) playMute(); else playUnmute()
  },

  toggleDeafen: () => {
    const next = !get().isDeafened
    if (next) {
      webrtcManager.setAudioEnabled(false)
      set({ isDeafened: true, isMuted: true })
      playDeafen()
    } else {
      webrtcManager.setAudioEnabled(true)
      set({ isDeafened: false, isMuted: false })
      playUndeafen()
    }
  },

  setStreaming: (userId, streaming) => {
    const selfId = useIdentityStore.getState().identity?.userId
    // Fire the stream-start/stop chime when a REMOTE peer toggles streaming —
    // the local path is already covered in startStreamFromSource/stopStream so
    // the local user doesn't hear a double-ding.
    if (userId !== selfId) {
      const wasStreaming = get().streamingUsers.has(userId)
      if (streaming && !wasStreaming) playStreamStart()
      else if (!streaming && wasStreaming) playStreamStop()
    }
    set((s) => {
      const streamingUsers = new Set(s.streamingUsers)
      if (streaming) streamingUsers.add(userId)
      else streamingUsers.delete(userId)
      // Mirror onto the participant record's isScreenSharing flag for the side panel
      const participants = s.participants.map((p) =>
        p.userId === userId ? { ...p, isScreenSharing: streaming } : p
      )
      return { streamingUsers, participants }
    })
  },

  setStreamQuality: (quality) => set({ streamQuality: quality }),

  startStreamFromSource: async (source, quality) => {
    const { width, height, frameRate } = resolveQuality(quality)
    const selfId = useIdentityStore.getState().identity?.userId

    // Quietly dispose of any previous local stream — don't emit stream:stop
    // here, because we're about to immediately emit stream:start again.
    const prev = get().localMediaStream
    if (prev) {
      for (const t of prev.getTracks()) t.stop()
    }
    webrtcManager.stopScreenShare()
    webrtcManager.stopVideo()
    set({ localMediaStream: null, isScreenSharing: false, isCameraOn: false })

    if (source.kind === 'camera') {
      // Camera path — use enumerated deviceId + quality constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: source.deviceId ? { exact: source.deviceId } : undefined,
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate }
        }
      })
      await webrtcManager.attachVideoStream(stream)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        get().stopStream()
      })
      set({
        isCameraOn: true,
        isScreenSharing: false,
        streamQuality: quality,
        currentStreamSource: source,
        localMediaStream: stream,
        previewVisible: true
      })
      if (selfId) get().setStreaming(selfId, true)
    } else {
      // Screen / window path — Electron's chromeMediaSource constraint form.
      // This bypasses getDisplayMedia entirely so we can target a specific
      // source picked from our custom modal.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-expect-error — Chrome/Electron non-standard constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.sourceId,
            maxWidth: width,
            maxHeight: height,
            maxFrameRate: frameRate
          }
        }
      })
      await webrtcManager.attachScreenStream(stream)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        get().stopStream()
      })
      set({
        isScreenSharing: true,
        isCameraOn: false,
        streamQuality: quality,
        currentStreamSource: source,
        localMediaStream: stream,
        previewVisible: true
      })
      if (selfId) get().setStreaming(selfId, true)
    }

    // Notify peers so they can render a LIVE badge even before media tracks arrive
    window.api.signaling.emit('stream:start', get().currentServerId, {
      userId: selfId,
      kind: source.kind
    })
    playStreamStart()
  },

  stopStream: () => {
    const selfId = useIdentityStore.getState().identity?.userId
    const wasStreaming = get().isScreenSharing || get().isCameraOn
    webrtcManager.stopScreenShare()
    webrtcManager.stopVideo()
    set({
      isScreenSharing: false,
      isCameraOn: false,
      currentStreamSource: null,
      localMediaStream: null
    })
    if (selfId) get().setStreaming(selfId, false)
    window.api.signaling.emit('stream:stop', get().currentServerId, { userId: selfId })
    if (wasStreaming) playStreamStop()
  },

  openPicker: (tab = 'applications') => set({ pickerOpen: true, pickerInitialTab: tab }),
  closePicker: () => set({ pickerOpen: false }),
  openStreamViewer: (userId: string) => set({ viewingStreamUserId: userId }),
  closeStreamViewer: () => set({ viewingStreamUserId: null }),
  hidePreview: () => set({ previewVisible: false }),
  showPreview: () => set({ previewVisible: true })
}))

function resolveQuality(q: StreamQuality): { width: number; height: number; frameRate: number } {
  return q === 'HD'
    ? { width: 1920, height: 1080, frameRate: 60 }
    : { width: 1280, height: 720, frameRate: 30 }
}

// Wire WebRTC callbacks to the store defensively to avoid overwriting call.store.ts
const prevVoiceRemoteStream = webrtcManager.onRemoteStream
webrtcManager.onRemoteStream = (userId, stream) => {
  try { prevVoiceRemoteStream?.(userId, stream) } catch { /* ignore */ }
  useVoiceStore.getState().setRemoteStream(userId, stream)
}

const prevVoicePeerConnected = webrtcManager.onPeerConnected
webrtcManager.onPeerConnected = (userId) => {
  try { prevVoicePeerConnected?.(userId) } catch { /* ignore */ }
  const existing = useVoiceStore.getState().participants.find((p) => p.userId === userId)
  if (!existing) {
    useVoiceStore.getState().addParticipant({
      userId,
      username: `Peer ${userId.slice(0, 6)}`,
      avatarColor: null,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
      isScreenSharing: false,
      isCameraOn: false
    })
    // Only ding for peers who join our voice channel — not for DM call peers
    // (call.store handles those through call-connect).
    if (useVoiceStore.getState().isConnected) playPeerJoinVoice()
  }
}

const prevVoicePeerDisconnected = webrtcManager.onPeerDisconnected
webrtcManager.onPeerDisconnected = (userId) => {
  try { prevVoicePeerDisconnected?.(userId) } catch { /* ignore */ }
  const wasInVoice = useVoiceStore.getState().isConnected
    && useVoiceStore.getState().participants.some((p) => p.userId === userId)
  useVoiceStore.getState().removeParticipant(userId)
  if (wasInVoice) playPeerLeaveVoice()
}
