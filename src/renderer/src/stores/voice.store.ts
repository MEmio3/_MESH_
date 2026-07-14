import { create } from 'zustand'
import type { VoiceParticipant } from '@/types/server'
import { useIdentityStore } from './identity.store'
import { useAudioPrefsStore } from './audioPrefs.store'
import { useChannelsStore } from './channels.store'
import { useServersStore } from './servers.store'
import { mediaEngine } from '@/lib/media-engine'
import { resolveChannelPerm } from '../../../shared/permissions'
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
  includeAudio?: boolean
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
  pausedStreamUsers: Set<string> // live streams whose window/tab source is currently paused
  localMediaStream: MediaStream | null // reactive handle to self-preview stream
  isMuted: boolean
  isDeafened: boolean
  /** Channel denies the Speak permission — mic is force-muted, unmute blocked. */
  speakLocked: boolean
  /** Channel denies the Stream permission — screen/camera start is blocked. */
  streamLocked: boolean
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
  restoreAfterReconnect: () => void
  addParticipant: (participant: VoiceParticipant) => void
  removeParticipant: (userId: string) => void
  setRemoteStream: (userId: string, stream: MediaStream) => void
  clearRemoteVideoStream: (userId: string) => void
  setParticipantSpeaking: (userId: string, speaking: boolean) => void
  toggleMute: () => void
  toggleDeafen: () => void

  // Streaming state
  setStreaming: (userId: string, streaming: boolean) => void
  setStreamPaused: (userId: string, paused: boolean) => void
  setLocalStreamPaused: (paused: boolean) => void
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

function voiceRoomId(serverId: string | null, channelId: string | null): string | null {
  if (!serverId) return null
  return `voice:${serverId}:${channelId ?? 'legacy'}`
}

function setLocalVoiceOccupant(
  serverId: string,
  channelId: string | null,
  identity: { userId: string; username: string; avatarColor?: string | null } | null | undefined
): void {
  if (!identity?.userId) return
  useServersStore.setState((s) => {
    const serverOccupants = s.serverVoiceStates[serverId] || {}
    return {
      serverVoiceStates: {
        ...s.serverVoiceStates,
        [serverId]: {
          ...serverOccupants,
          [identity.userId]: {
            channelId: channelId ?? 'legacy',
            username: identity.username,
            avatarColor: identity.avatarColor ?? null
          }
        }
      }
    }
  })
}

function clearLocalVoiceOccupant(serverId: string | null, userId: string | null | undefined): void {
  if (!serverId || !userId) return
  useServersStore.setState((s) => {
    const serverOccupants = { ...(s.serverVoiceStates[serverId] || {}) }
    delete serverOccupants[userId]
    return {
      serverVoiceStates: {
        ...s.serverVoiceStates,
        [serverId]: serverOccupants
      }
    }
  })
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  isConnected: false,
  currentServerId: null,
  currentChannelId: null,
  participants: [],
  remoteStreams: new Map(),
  streamingUsers: new Set(),
  pausedStreamUsers: new Set(),
  localMediaStream: null,
  isMuted: false,
  isDeafened: false,
  speakLocked: false,
  streamLocked: false,
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
    const identity = useIdentityStore.getState().identity
    // No-op if already in this exact voice channel.
    if (state.isConnected && state.currentServerId === serverId && state.currentChannelId === nextChannelId) {
      setLocalVoiceOccupant(serverId, nextChannelId, identity)
      return
    }
    // The media engine holds ONE active room. If a 1-to-1 call is live, end it
    // before entering voice so call media can't leak into the voice room
    // (mirror of call.store leaving voice before a call). Lazy import avoids a
    // circular dependency with call.store.
    try {
      const { useCallStore } = await import('./call.store')
      if (useCallStore.getState().status !== 'idle') useCallStore.getState().end(true)
    } catch { /* call store unavailable — nothing to end */ }

    // Switching within the same server? Hop rooms without tearing down audio.
    const isSwitching = state.isConnected && state.currentServerId === serverId
    if (state.isConnected && (state.isScreenSharing || state.isCameraOn)) {
      get().stopStream()
    }
    if (isSwitching) {
      mediaEngine.resetPeers()
      const previousRoomId = voiceRoomId(state.currentServerId, state.currentChannelId)
      if (previousRoomId) window.api.signaling.emit('leave-room', previousRoomId)
      else window.api.signaling.emit('leave-room')
      clearLocalVoiceOccupant(state.currentServerId, identity?.userId)
      // Give the signaling server time to fan out `server:voice-left` to
      // remote peers BEFORE we emit the new join. Without this delay the
      // new voice-joined races ahead of the leave on other clients,
      // producing ghost entries (same user appearing in two channels at
      // once in the sidebar).
      await new Promise((r) => setTimeout(r, 500))
    } else if (state.isConnected) {
      // Joining a different server — do a full leave first.
      mediaEngine.leaveRoom()
      const previousRoomId = voiceRoomId(state.currentServerId, state.currentChannelId)
      if (previousRoomId) window.api.signaling.emit('leave-room', previousRoomId)
      else window.api.signaling.emit('leave-room')
      clearLocalVoiceOccupant(state.currentServerId, identity?.userId)
      await new Promise((r) => setTimeout(r, 500))
    }

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
      streamingUsers: new Set(),
      pausedStreamUsers: new Set()
    })
    setLocalVoiceOccupant(serverId, nextChannelId, identity)

    if (!isSwitching) {
      try {
        // Respect the user's globally-selected mic + input volume.
        const prefs = useAudioPrefsStore.getState()
        mediaEngine.setInputGain(prefs.inputVolume / 100)
        await mediaEngine.startMic(prefs.inputDeviceId || undefined)
      } catch (err) {
        console.error('Failed to start audio:', err)
      }
    }
    // Per-channel audio bitrate (channel settings).
    const channelDef = nextChannelId
      ? useChannelsStore.getState().byServer[serverId]?.channels.find((c) => c.id === nextChannelId)
      : undefined
    mediaEngine.setAudioBitrate(channelDef?.bitrateKbps ?? null)

    // Per-channel Speak/Stream permissions — enforced, not decorative.
    const meMember = useServersStore.getState().serverMembers[serverId]?.find(
      (m) => m.userId === identity?.userId
    )
    const roleDefs = useServersStore.getState().serverRoles[serverId] ?? []
    const chanPerm = (key: 'speak' | 'stream'): boolean =>
      channelDef
        ? resolveChannelPerm({
            tier: meMember?.role ?? 'member',
            roleIds: meMember?.roleIds ?? [],
            roles: roleDefs,
            overrides: channelDef.overrides,
            minRole: channelDef.minRole,
            allowedRoleIds: channelDef.allowedRoleIds,
            key
          })
        : true
    const speakLocked = !chanPerm('speak')
    const streamLocked = !chanPerm('stream')
    if (speakLocked) {
      // Denied Speak: join muted, and the mute toggle is locked shut.
      mediaEngine.setMicEnabled(false)
    } else {
      mediaEngine.setMicEnabled(!get().isMuted)
    }
    set({ speakLocked, streamLocked, isMuted: speakLocked ? true : get().isMuted })

    // Scope the room to server + channel so different voice channels are
    // separate rooms (users in #gaming don't hear users in #voice-lounge).
    // `legacy` bucket keeps pre-channels callers (ServerVoiceRoom without a
    // channelId) on a shared room so existing behavior is unchanged.
    const roomId = voiceRoomId(serverId, nextChannelId) ?? `voice:${serverId}:legacy`
    mediaEngine.joinRoom(roomId)
    window.api.signaling.emit('join-room', roomId)
    // Only play the self-join chime on a fresh join; room-hopping within the
    // same server shouldn't ding twice.
    if (!isSwitching) playVoiceSelfJoin()
  },

  restoreAfterReconnect: () => {
    const state = get()
    if (!state.isConnected || !state.currentServerId) return
    const roomId = voiceRoomId(state.currentServerId, state.currentChannelId) ?? `voice:${state.currentServerId}:legacy`
    window.api.signaling.emit('join-room', roomId)

    const selfId = useIdentityStore.getState().identity?.userId
    if (selfId && (state.isScreenSharing || state.isCameraOn) && state.currentStreamSource) {
      window.api.signaling.emit('stream:start', state.currentServerId, {
        userId: selfId,
        kind: state.currentStreamSource.kind,
        paused: state.pausedStreamUsers.has(selfId)
      })
    }
  },

  leaveRoom: () => {
    const state = get()
    const identity = useIdentityStore.getState().identity
    const wasConnected = state.isConnected
    const roomId = voiceRoomId(state.currentServerId, state.currentChannelId)
    if (state.isScreenSharing || state.isCameraOn) {
      get().stopStream()
    }
    mediaEngine.setAudioBitrate(null)
    get().localMediaStream?.getTracks().forEach((t) => t.stop())
    mediaEngine.leaveRoom()
    if (roomId) window.api.signaling.emit('leave-room', roomId)
    else window.api.signaling.emit('leave-room')
    clearLocalVoiceOccupant(state.currentServerId, identity?.userId)
    if (wasConnected) playVoiceSelfLeave()
    set({
      isConnected: false,
      currentServerId: null,
      currentChannelId: null,
      participants: [],
      remoteStreams: new Map(),
      streamingUsers: new Set(),
      pausedStreamUsers: new Set(),
      localMediaStream: null,
      isMuted: false,
      isDeafened: false,
      speakLocked: false,
      streamLocked: false,
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
      const pausedStreamUsers = new Set(s.pausedStreamUsers)
      pausedStreamUsers.delete(userId)
      return {
        participants: s.participants.filter((p) => p.userId !== userId),
        remoteStreams,
        streamingUsers,
        pausedStreamUsers
      }
    })
  },

  setRemoteStream: (userId, stream) => {
    set((s) => {
      const remoteStreams = new Map(s.remoteStreams)
      // MERGE with any existing stream for this user instead of replacing.
      // ontrack fires with a different MediaStream object per source (mic
      // stream vs screen/camera stream) — a naive replace dropped the peer's
      // audio the moment they started streaming video.
      const existing = remoteStreams.get(userId)
      let next = stream
      if (existing && existing !== stream) {
        const merged = new MediaStream()
        for (const t of [...existing.getTracks(), ...stream.getTracks()]) {
          if (t.readyState === 'live' && !merged.getTracks().some((m) => m.id === t.id)) {
            merged.addTrack(t)
          }
        }
        next = merged
      }
      remoteStreams.set(userId, next)
      // If the stream has live video tracks, mark the user as streaming
      const streamingUsers = new Set(s.streamingUsers)
      if (next.getVideoTracks().some((t) => t.readyState === 'live')) {
        streamingUsers.add(userId)
      }
      return { remoteStreams, streamingUsers }
    })
  },

  clearRemoteVideoStream: (userId) => {
    set((s) => {
      const remoteStreams = new Map(s.remoteStreams)
      const existing = remoteStreams.get(userId)
      if (existing) {
        for (const track of existing.getVideoTracks()) {
          try { track.stop() } catch { /* ignore */ }
        }
        const audioTracks = existing.getAudioTracks().filter((track) => track.readyState === 'live')
        if (audioTracks.length > 0) {
          remoteStreams.set(userId, new MediaStream(audioTracks))
        } else {
          remoteStreams.delete(userId)
        }
      }

      const streamingUsers = new Set(s.streamingUsers)
      streamingUsers.delete(userId)
      const pausedStreamUsers = new Set(s.pausedStreamUsers)
      pausedStreamUsers.delete(userId)
      const participants = s.participants.map((p) =>
        p.userId === userId ? { ...p, isScreenSharing: false, isCameraOn: false } : p
      )
      return { remoteStreams, streamingUsers, pausedStreamUsers, participants }
    })
  },

  setParticipantSpeaking: (userId, speaking) => {
    set((s) => ({
      participants: s.participants.map((p) =>
        p.userId === userId && p.isSpeaking !== speaking ? { ...p, isSpeaking: speaking } : p
      )
    }))
  },

  toggleMute: () => {
    // Speak denied by the channel — the mic stays shut.
    if (get().speakLocked && get().isConnected) return
    const next = !get().isMuted
    mediaEngine.setMicEnabled(!next)
    set({ isMuted: next })
    if (next) {
      const selfId = useIdentityStore.getState().identity?.userId
      if (selfId) get().setParticipantSpeaking(selfId, false)
    }
    if (next) playMute(); else playUnmute()
  },

  toggleDeafen: () => {
    const next = !get().isDeafened
    if (next) {
      mediaEngine.setMicEnabled(false)
      set({ isDeafened: true, isMuted: true })
      const selfId = useIdentityStore.getState().identity?.userId
      if (selfId) get().setParticipantSpeaking(selfId, false)
      playDeafen()
    } else {
      // Undeafen restores the mic only if the channel lets this member speak.
      const locked = get().speakLocked && get().isConnected
      mediaEngine.setMicEnabled(!locked)
      set({ isDeafened: false, isMuted: locked })
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
      const pausedStreamUsers = new Set(s.pausedStreamUsers)
      if (!streaming) pausedStreamUsers.delete(userId)
      // Mirror onto the participant record's isScreenSharing flag for the side panel
      const participants = s.participants.map((p) =>
        p.userId === userId ? { ...p, isScreenSharing: streaming } : p
      )
      return { streamingUsers, pausedStreamUsers, participants }
    })
  },

  setStreamPaused: (userId, paused) => {
    set((s) => {
      const pausedStreamUsers = new Set(s.pausedStreamUsers)
      if (paused) pausedStreamUsers.add(userId)
      else pausedStreamUsers.delete(userId)
      return { pausedStreamUsers }
    })
  },

  setLocalStreamPaused: (paused) => {
    const selfId = useIdentityStore.getState().identity?.userId
    const serverId = get().currentServerId
    if (!selfId || !serverId) return
    const state = get()
    if (!state.isScreenSharing || state.currentStreamSource?.kind !== 'window') return
    const alreadyPaused = state.pausedStreamUsers.has(selfId)
    if (alreadyPaused === paused) return
    get().setStreamPaused(selfId, paused)
    window.api.signaling.emit('stream:pause', serverId, { userId: selfId, paused })
  },

  setStreamQuality: (quality) => set({ streamQuality: quality }),

  startStreamFromSource: async (source, quality) => {
    // Stream denied by the channel — hard stop, regardless of UI path.
    if (get().streamLocked && get().isConnected) return
    const { width, height, frameRate } = resolveQuality(quality)
    const selfId = useIdentityStore.getState().identity?.userId

    // Quietly dispose of any previous local stream — don't emit stream:stop
    // here, because we're about to immediately emit stream:start again.
    const prev = get().localMediaStream
    if (prev) {
      for (const t of prev.getTracks()) t.stop()
    }
    mediaEngine.stopVideo()
    set({ localMediaStream: null, isScreenSharing: false, isCameraOn: false })
    if (selfId) get().setStreamPaused(selfId, false)

    // Encoder bitrate scales with the chosen quality.
    const videoBitrate = quality === 'HD' ? 6_000_000 : 2_500_000

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
      await mediaEngine.attachVideoStream(stream, 'camera', videoBitrate)
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
        audio: source.includeAudio
          ? ({
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: source.sourceId
              }
            } as MediaTrackConstraints)
          : false,
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
      await mediaEngine.attachVideoStream(stream, 'screen', videoBitrate)
      const videoTrack = stream.getVideoTracks()[0]
      videoTrack?.addEventListener('ended', () => {
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
      if (source.kind === 'window' && videoTrack) {
        const setPausedFromTrack = (paused: boolean): void => {
          get().setLocalStreamPaused(paused)
        }
        videoTrack.addEventListener('mute', () => setPausedFromTrack(true))
        videoTrack.addEventListener('unmute', () => setPausedFromTrack(false))
        setPausedFromTrack(videoTrack.muted)
      }
    }

    // Notify peers so they can render a LIVE badge even before media tracks arrive
    const serverId = get().currentServerId
    if (serverId && selfId) {
      window.api.signaling.emit('stream:start', serverId, {
        userId: selfId,
        kind: source.kind,
        paused: selfId ? get().pausedStreamUsers.has(selfId) : false
      })
    }
    playStreamStart()
  },

  stopStream: () => {
    const selfId = useIdentityStore.getState().identity?.userId
    const wasStreaming = get().isScreenSharing || get().isCameraOn
    mediaEngine.stopVideo()
    get().localMediaStream?.getTracks().forEach((t) => t.stop())
    set({
      isScreenSharing: false,
      isCameraOn: false,
      currentStreamSource: null,
      localMediaStream: null
    })
    if (selfId) get().setStreaming(selfId, false)
    const serverId = get().currentServerId
    if (serverId && selfId) {
      window.api.signaling.emit('stream:stop', serverId, { userId: selfId })
    }
    if (wasStreaming) playStreamStop()
  },

  openPicker: (tab = 'applications') => {
    if (get().streamLocked && get().isConnected) return
    set({ pickerOpen: true, pickerInitialTab: tab })
  },
  closePicker: () => set({ pickerOpen: false }),
  openStreamViewer: (userId: string) => {
    mediaEngine.requestKeyframe(userId)
    set({ viewingStreamUserId: userId })
  },
  closeStreamViewer: () => set({ viewingStreamUserId: null }),
  hidePreview: () => set({ previewVisible: false }),
  showPreview: () => set({ previewVisible: true })
}))

function resolveQuality(q: StreamQuality): { width: number; height: number; frameRate: number } {
  return q === 'HD'
    ? { width: 1920, height: 1080, frameRate: 60 }
    : { width: 1280, height: 720, frameRate: 30 }
}

/** Add a room participant, resolving their real username from the server
 *  roster when we have it. Exported for useSignaling's user-joined hook. */
export function addVoiceParticipant(userId: string): void {
  const vs = useVoiceStore.getState()
  if (!vs.isConnected) return
  if (vs.participants.find((p) => p.userId === userId)) return
  const serverId = vs.currentServerId
  const member = serverId
    ? useServersStore.getState().serverMembers[serverId]?.find((m) => m.userId === userId)
    : undefined
  // Fall back to the server-authoritative voice occupancy identity when the
  // member roster hasn't synced this user yet — avoids the "Peer usr_…"
  // placeholder and name-flicker.
  const occ = serverId ? useServersStore.getState().serverVoiceStates[serverId]?.[userId] : undefined
  vs.addParticipant({
    userId,
    username: member?.username ?? occ?.username ?? `Peer ${userId.slice(0, 6)}`,
    avatarColor: member?.avatarColor ?? occ?.avatarColor ?? null,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
    isScreenSharing: false,
    isCameraOn: false
  })
  if (vs.isConnected) playPeerJoinVoice()
}

// Wire media-engine callbacks defensively (call.store composes after us).
const prevVoiceRemoteStream = mediaEngine.onRemoteStream
mediaEngine.onRemoteStream = (userId, stream) => {
  try { prevVoiceRemoteStream?.(userId, stream) } catch { /* ignore */ }
  const vs = useVoiceStore.getState()
  if (!vs.isConnected) return
  vs.setRemoteStream(userId, stream)
}

const prevVoiceActive = mediaEngine.onParticipantVoice
mediaEngine.onParticipantVoice = (userId) => {
  try { prevVoiceActive?.(userId) } catch { /* ignore */ }
  addVoiceParticipant(userId)
}

const prevLocalVoiceActivity = mediaEngine.onLocalVoiceActivity
mediaEngine.onLocalVoiceActivity = (active) => {
  try { prevLocalVoiceActivity?.(active) } catch { /* ignore */ }
  const selfId = useIdentityStore.getState().identity?.userId
  if (!selfId) return
  const state = useVoiceStore.getState()
  state.setParticipantSpeaking(selfId, active && state.isConnected && !state.isMuted && !state.isDeafened)
}

const prevParticipantVoiceActivity = mediaEngine.onParticipantVoiceActivity
mediaEngine.onParticipantVoiceActivity = (userId, active) => {
  try { prevParticipantVoiceActivity?.(userId, active) } catch { /* ignore */ }
  const vs = useVoiceStore.getState()
  if (!vs.isConnected) return
  if (active) addVoiceParticipant(userId)
  vs.setParticipantSpeaking(userId, active)
}

const prevVoiceLeft = mediaEngine.onParticipantLeft
mediaEngine.onParticipantLeft = (userId) => {
  try { prevVoiceLeft?.(userId) } catch { /* ignore */ }
  const wasInVoice = useVoiceStore.getState().isConnected
    && useVoiceStore.getState().participants.some((p) => p.userId === userId)
  useVoiceStore.getState().removeParticipant(userId)
  if (wasInVoice) playPeerLeaveVoice()
}
