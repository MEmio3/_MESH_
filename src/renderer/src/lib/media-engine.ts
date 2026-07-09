/**
 * MeshMediaEngine — host-relayed voice/video with NO WebRTC anywhere.
 *
 * Why: peer-to-peer media (WebRTC/ICE) never connected reliably on real
 * networks, while everything routed through the signaling host (text,
 * files, presence) always worked. So media now rides the exact same
 * socket: capture → WebCodecs encode (Opus / VP8) → binary frames over
 * socket.io → host relays to the room → receivers decode and play.
 * If a text message gets through, voice gets through. Same pipe.
 *
 * Receivers expose ordinary MediaStreams (audio via a
 * MediaStreamAudioDestinationNode, video via canvas.captureStream), so the
 * existing UI — VoiceAudioEngine, stream tiles, the viewer, CallOverlay —
 * keeps working without modification.
 */

/* Minimal typings for Chromium APIs that may be missing from lib.dom. */
declare class MediaStreamTrackProcessor<T> {
  constructor(init: { track: MediaStreamTrack })
  readable: ReadableStream<T>
}

interface AudioPacketMeta {
  seq: number
  sampleRate: number
  channels: number
}

interface VideoPacketMeta {
  seq: number
  key: boolean
  kind: 'camera' | 'screen'
  w: number
  h: number
}

export interface MediaEngineStats {
  rttMs: number | null
  upKbps: number
  downKbps: number
}

interface PeerState {
  audioDecoder: AudioDecoder | null
  audioCfg: string
  audioCtxDest: MediaStreamAudioDestinationNode
  nextPlayTime: number
  lastAudioSeq: number
  videoDecoder: VideoDecoder | null
  canvas: HTMLCanvasElement
  canvasCtx: CanvasRenderingContext2D
  canvasStream: MediaStream | null
  awaitingKey: boolean
  lastKeyframeRequestAt: number
  lastVideoSeq: number
  emittedAudio: boolean
}

const AUDIO_TIMESLICE_US = 20_000 // Opus frame duration the encoder targets
const JITTER_S = 0.09             // playback cushion — ~90ms feels instant on LAN
const KEYFRAME_INTERVAL = 60      // video keyframe every N frames (~2s at 30fps)
const VOICE_RMS_ON = 0.018
const VOICE_RMS_OFF = 0.01
const VOICE_HOLD_MS = 420

interface VoiceActivityState {
  active: boolean
  offTimer: ReturnType<typeof setTimeout> | null
}

class MeshMediaEngine {
  // ── Callbacks (assigned by the store wiring, composed like webrtcManager's) ──
  onRemoteStream: ((userId: string, stream: MediaStream) => void) | null = null
  onParticipantVoice: ((userId: string) => void) | null = null
  onParticipantVoiceActivity: ((userId: string, active: boolean) => void) | null = null
  onLocalVoiceActivity: ((active: boolean) => void) | null = null
  onParticipantLeft: ((userId: string) => void) | null = null
  onStats: ((stats: MediaEngineStats) => void) | null = null

  // ── Outgoing state ──
  private roomId: string | null = null
  private micStream: MediaStream | null = null
  private micTrack: MediaStreamTrack | null = null
  private micEnabled = true
  private audioEncoder: AudioEncoder | null = null
  private audioReader: ReadableStreamDefaultReader<AudioData> | null = null
  private audioSeq = 0
  private audioBitrateKbps = 32
  private inputCtx: AudioContext | null = null
  private inputGain: GainNode | null = null
  private inputGainValue = 1
  private rawMicStream: MediaStream | null = null

  private videoStream: MediaStream | null = null
  private videoEncoder: VideoEncoder | null = null
  private videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null
  private videoSeq = 0
  private videoKind: 'camera' | 'screen' = 'screen'
  private videoBitrate = 2_500_000
  // When set, the next encoded video frame is forced to be a keyframe. Used so
  // a viewer who joins mid-stream can start decoding immediately instead of
  // waiting up to KEYFRAME_INTERVAL frames for the next periodic keyframe
  // (VP8 deltas are useless without a reference frame).
  private forceKeyframeNext = false

  // ── Incoming state (per remote user) ──
  private peers = new Map<string, PeerState>()

  private playCtx: AudioContext | null = null
  private listenersReady = false

  // ── Telemetry ──
  private bytesUp = 0
  private bytesDown = 0
  private lastRtt: number | null = null
  private lastUdpPongAt = 0
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private localVoiceActive = false
  private localVoiceOffTimer: ReturnType<typeof setTimeout> | null = null
  private remoteVoiceActivity = new Map<string, VoiceActivityState>()

  /** Wire the socket → engine event listeners exactly once. */
  init(): void {
    if (this.listenersReady) return
    this.listenersReady = true

    window.api.signaling.onMediaAudio((userId, meta, payload) => {
      this.bytesDown += payload.byteLength
      this.handleAudioPacket(userId, meta as AudioPacketMeta, payload)
    })
    window.api.signaling.onMediaVideo((userId, meta, payload) => {
      this.bytesDown += payload.byteLength
      this.handleVideoPacket(userId, meta as VideoPacketMeta, payload)
    })
    window.api.signaling.onMediaPong((sentAt, transport) => {
      this.lastRtt = Math.max(0, Math.round(performance.now() - sentAt))
      if (transport === 'udp') this.lastUdpPongAt = performance.now()
    })
    window.api.signaling.onMediaKeyframeRequest((roomId) => {
      if (this.roomId === roomId) this.forceKeyframe()
    })
  }

  // ─────────────────────────── Session ───────────────────────────

  joinRoom(roomId: string): void {
    this.init()
    this.roomId = roomId
    this.setLocalVoiceActivity(false)
    this.sendVoicePing()
    this.startStatsLoop()
  }

  leaveRoom(): void {
    this.roomId = null
    this.stopMic()
    this.stopVideo()
    for (const userId of [...this.peers.keys()]) this.dropPeer(userId)
    this.stopStatsLoop()
  }

  /** Drop all remote decode state (e.g. when hopping channels) but keep the
   *  local mic/video pipelines running. */
  resetPeers(): void {
    for (const userId of [...this.peers.keys()]) this.dropPeer(userId)
  }

  /** Force the next outgoing video frame to be a keyframe. Called when a new
   *  viewer joins the room so they can begin decoding immediately. No-op if
   *  we aren't currently sending video. */
  forceKeyframe(): void {
    if (this.videoEncoder) this.forceKeyframeNext = true
  }

  requestKeyframe(userId?: string): void {
    if (!this.roomId) return
    window.api.signaling.emit('media:keyframe-request', this.roomId, userId)
  }

  /** A room member left (signaling user-left) — release their decoders. */
  handleUserLeft(userId: string): void {
    this.dropPeer(userId)
    this.onParticipantLeft?.(userId)
  }

  private dropPeer(userId: string): void {
    const p = this.peers.get(userId)
    if (!p) return
    try { p.audioDecoder?.close() } catch { /* ignore */ }
    try { p.videoDecoder?.close() } catch { /* ignore */ }
    p.canvasStream?.getTracks().forEach((t) => t.stop())
    this.peers.delete(userId)
    this.clearRemoteVoiceActivity(userId)
  }

  // ─────────────────────────── Microphone ───────────────────────────

  private measureAudioRms(data: AudioData): number {
    try {
      const frames = data.numberOfFrames
      const channels = Math.min(data.numberOfChannels, 2)
      if (frames <= 0 || channels <= 0) return 0

      let sum = 0
      let count = 0
      for (let ch = 0; ch < channels; ch++) {
        const samples = new Float32Array(frames)
        data.copyTo(samples, { planeIndex: ch, format: 'f32-planar' })
        for (let i = 0; i < samples.length; i++) {
          const sample = samples[i]
          sum += sample * sample
          count++
        }
      }
      return count > 0 ? Math.sqrt(sum / count) : 0
    } catch {
      return 0
    }
  }

  private setLocalVoiceActivity(active: boolean): void {
    if (this.localVoiceOffTimer) {
      clearTimeout(this.localVoiceOffTimer)
      this.localVoiceOffTimer = null
    }
    if (this.localVoiceActive === active) return
    this.localVoiceActive = active
    this.onLocalVoiceActivity?.(active)
  }

  private updateLocalVoiceActivity(rms: number): void {
    if (!this.micEnabled || !this.roomId) {
      this.setLocalVoiceActivity(false)
      return
    }
    if (rms >= VOICE_RMS_ON) {
      this.setLocalVoiceActivity(true)
      return
    }
    if (this.localVoiceActive && rms <= VOICE_RMS_OFF && !this.localVoiceOffTimer) {
      this.localVoiceOffTimer = setTimeout(() => {
        this.localVoiceOffTimer = null
        this.setLocalVoiceActivity(false)
      }, VOICE_HOLD_MS)
    }
  }

  private setRemoteVoiceActivity(userId: string, active: boolean): void {
    let state = this.remoteVoiceActivity.get(userId)
    if (!state) {
      state = { active: false, offTimer: null }
      this.remoteVoiceActivity.set(userId, state)
    }
    if (state.offTimer) {
      clearTimeout(state.offTimer)
      state.offTimer = null
    }
    if (state.active === active) return
    state.active = active
    this.onParticipantVoiceActivity?.(userId, active)
  }

  private updateRemoteVoiceActivity(userId: string, rms: number): void {
    const state = this.remoteVoiceActivity.get(userId)
    if (rms >= VOICE_RMS_ON) {
      this.setRemoteVoiceActivity(userId, true)
      return
    }
    if (state?.active && rms <= VOICE_RMS_OFF && !state.offTimer) {
      state.offTimer = setTimeout(() => {
        state.offTimer = null
        this.setRemoteVoiceActivity(userId, false)
      }, VOICE_HOLD_MS)
    }
  }

  private clearRemoteVoiceActivity(userId: string): void {
    const state = this.remoteVoiceActivity.get(userId)
    if (!state) return
    if (state.offTimer) clearTimeout(state.offTimer)
    this.remoteVoiceActivity.delete(userId)
    if (state.active) this.onParticipantVoiceActivity?.(userId, false)
  }

  async startMic(deviceId?: string): Promise<void> {
    this.stopMic()
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true
    })
    this.rawMicStream = raw

    // Input gain graph so the user's input-volume slider keeps working.
    if (!this.inputCtx) this.inputCtx = new AudioContext({ sampleRate: 48000 })
    if (this.inputCtx.state === 'suspended') this.inputCtx.resume().catch(() => {})
    const src = this.inputCtx.createMediaStreamSource(raw)
    const gain = this.inputCtx.createGain()
    gain.gain.value = this.inputGainValue
    const dest = this.inputCtx.createMediaStreamDestination()
    src.connect(gain).connect(dest)
    this.inputGain = gain
    this.micStream = dest.stream
    this.micTrack = dest.stream.getAudioTracks()[0] ?? null
    if (!this.micTrack) throw new Error('No audio track from microphone')

    await this.startAudioEncoder(this.micTrack)
  }

  private async startAudioEncoder(track: MediaStreamTrack): Promise<void> {
    const settings = track.getSettings()
    const sampleRate = settings.sampleRate ?? 48000
    const channels = settings.channelCount ?? 1

    const encoder = new AudioEncoder({
      output: (chunk) => this.shipAudioChunk(chunk, sampleRate, channels),
      error: (e) => console.error('[media] audio encoder:', e)
    })
    encoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels: channels,
      bitrate: this.audioBitrateKbps * 1000,
      opus: { frameDuration: AUDIO_TIMESLICE_US }
    })
    this.audioEncoder = encoder

    const processor = new MediaStreamTrackProcessor<AudioData>({ track })
    const reader = processor.readable.getReader()
    this.audioReader = reader
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done || !value) break
          if (this.audioEncoder === encoder && this.micEnabled && this.roomId) {
            this.updateLocalVoiceActivity(this.measureAudioRms(value))
            encoder.encode(value)
          } else {
            this.setLocalVoiceActivity(false)
          }
          value.close()
        }
      } catch { /* reader cancelled on stop */ }
    })()
  }

  private shipAudioChunk(chunk: EncodedAudioChunk, sampleRate: number, channels: number): void {
    if (!this.roomId) return
    const buf = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(buf)
    this.bytesUp += buf.byteLength
    const meta: AudioPacketMeta = { seq: this.audioSeq++, sampleRate, channels }
    if (this.hasFreshUdpVoicePath()) {
      window.api.signaling.emitVoiceUdpAudio(this.roomId, meta, buf)
    } else {
      window.api.signaling.emit('media:audio', this.roomId, meta, buf)
    }
  }

  stopMic(): void {
    try { this.audioReader?.cancel() } catch { /* ignore */ }
    this.audioReader = null
    try { this.audioEncoder?.close() } catch { /* ignore */ }
    this.audioEncoder = null
    this.rawMicStream?.getTracks().forEach((t) => t.stop())
    this.rawMicStream = null
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = null
    this.micTrack = null
    this.setLocalVoiceActivity(false)
  }

  /** Mute = simply stop shipping packets; capture keeps running. */
  setMicEnabled(enabled: boolean): void {
    this.micEnabled = enabled
    if (!enabled) this.setLocalVoiceActivity(false)
  }

  hasMic(): boolean {
    return !!this.micStream
  }

  setInputGain(gain: number): void {
    this.inputGainValue = Math.max(0, Math.min(2, gain))
    if (this.inputGain) this.inputGain.gain.value = this.inputGainValue
  }

  async replaceMicDevice(deviceId?: string): Promise<void> {
    const wasEnabled = this.micEnabled
    await this.startMic(deviceId)
    this.micEnabled = wasEnabled
  }

  /** Per-channel Opus bitrate cap (kbps); null restores the 32kbps default. */
  setAudioBitrate(kbps: number | null): void {
    this.audioBitrateKbps = kbps && kbps > 0 ? Math.min(kbps, 320) : 32
    // Applies on the next encoder start; live reconfigure of opus bitrate is
    // flaky across versions, and mic restarts are cheap.
  }

  // ─────────────────────────── Video / screen ───────────────────────────

  async attachVideoStream(stream: MediaStream, kind: 'camera' | 'screen', bitrate?: number): Promise<void> {
    this.stopVideo()
    this.videoStream = stream
    this.videoKind = kind
    if (bitrate) this.videoBitrate = bitrate
    const track = stream.getVideoTracks()[0]
    if (!track) return

    const encoder = new VideoEncoder({
      output: (chunk, meta) => this.shipVideoChunk(chunk, meta),
      error: (e) => console.error('[media] video encoder:', e)
    })
    const settings = track.getSettings()
    encoder.configure({
      codec: 'vp8',
      width: settings.width ?? 1280,
      height: settings.height ?? 720,
      bitrate: this.videoBitrate,
      framerate: settings.frameRate ?? 30,
      latencyMode: 'realtime'
    })
    this.videoEncoder = encoder

    const processor = new MediaStreamTrackProcessor<VideoFrame>({ track })
    const reader = processor.readable.getReader()
    this.videoReader = reader
    let frameCount = 0
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done || !value) break
          if (this.videoEncoder === encoder && this.roomId) {
            // Drop frames if the encoder is backlogged — realtime beats complete.
            if (encoder.encodeQueueSize <= 2) {
              const wantKey = this.forceKeyframeNext || frameCount % KEYFRAME_INTERVAL === 0
              this.forceKeyframeNext = false
              encoder.encode(value, { keyFrame: wantKey })
              frameCount++
            }
          }
          value.close()
        }
      } catch { /* reader cancelled on stop */ }
    })()
  }

  private shipVideoChunk(chunk: EncodedVideoChunk, _meta: EncodedVideoChunkMetadata | undefined): void {
    if (!this.roomId || !this.videoStream) return
    const buf = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(buf)
    this.bytesUp += buf.byteLength
    const settings = this.videoStream.getVideoTracks()[0]?.getSettings()
    const meta: VideoPacketMeta = {
      seq: this.videoSeq++,
      key: chunk.type === 'key',
      kind: this.videoKind,
      w: settings?.width ?? 1280,
      h: settings?.height ?? 720
    }
    window.api.signaling.emit('media:video', this.roomId, meta, buf)
  }

  stopVideo(): void {
    try { this.videoReader?.cancel() } catch { /* ignore */ }
    this.videoReader = null
    try { this.videoEncoder?.close() } catch { /* ignore */ }
    this.videoEncoder = null
    // The stream itself is owned by the caller (voice.store keeps it for
    // the self-preview) — we only stop encoding, not the tracks.
    this.videoStream = null
  }

  // ─────────────────────────── Incoming audio ───────────────────────────

  private ensurePeer(userId: string): PeerState {
    let p = this.peers.get(userId)
    if (p) return p
    if (!this.playCtx) this.playCtx = new AudioContext({ sampleRate: 48000 })
    if (this.playCtx.state === 'suspended') this.playCtx.resume().catch(() => {})
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const canvasCtx = canvas.getContext('2d')
    p = {
      audioDecoder: null,
      audioCfg: '',
      audioCtxDest: this.playCtx.createMediaStreamDestination(),
      nextPlayTime: 0,
      lastAudioSeq: -1,
      videoDecoder: null,
      canvas,
      canvasCtx: canvasCtx as CanvasRenderingContext2D,
      canvasStream: null,
      awaitingKey: true,
      lastKeyframeRequestAt: 0,
      lastVideoSeq: -1,
      emittedAudio: false
    }
    this.peers.set(userId, p)
    return p
  }

  private handleAudioPacket(userId: string, meta: AudioPacketMeta, payload: ArrayBuffer): void {
    const p = this.ensurePeer(userId)

    // (Re)configure the decoder when the sender's format changes.
    const cfg = `${meta.sampleRate}/${meta.channels}`
    if (!p.audioDecoder || p.audioCfg !== cfg) {
      try { p.audioDecoder?.close() } catch { /* ignore */ }
      p.audioDecoder = new AudioDecoder({
        output: (data) => this.playAudioData(userId, data),
        error: (e) => console.error('[media] audio decoder:', e)
      })
      p.audioDecoder.configure({
        codec: 'opus',
        sampleRate: meta.sampleRate,
        numberOfChannels: meta.channels
      })
      p.audioCfg = cfg
    }
    p.lastAudioSeq = meta.seq

    try {
      p.audioDecoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: meta.seq * AUDIO_TIMESLICE_US,
        data: payload
      }))
    } catch { /* skip a bad packet; opus recovers on the next one */ }

    if (!p.emittedAudio) {
      p.emittedAudio = true
      this.onRemoteStream?.(userId, p.audioCtxDest.stream)
    }
    this.onParticipantVoice?.(userId)
  }

  private playAudioData(userId: string, data: AudioData): void {
    const p = this.peers.get(userId)
    const ctx = this.playCtx
    if (!p || !ctx) { data.close(); return }
    try {
      const buffer = ctx.createBuffer(data.numberOfChannels, data.numberOfFrames, data.sampleRate)
      let sum = 0
      let count = 0
      for (let ch = 0; ch < data.numberOfChannels; ch++) {
        const arr = new Float32Array(data.numberOfFrames)
        data.copyTo(arr, { planeIndex: ch, format: 'f32-planar' })
        buffer.copyToChannel(arr, ch)
        for (let i = 0; i < arr.length; i++) {
          const sample = arr[i]
          sum += sample * sample
          count++
        }
      }
      if (count > 0) this.updateRemoteVoiceActivity(userId, Math.sqrt(sum / count))
      // Jitter-buffered scheduling: keep a small cushion, never schedule in
      // the past, glue segments back-to-back.
      const now = ctx.currentTime
      if (p.nextPlayTime < now + 0.01) p.nextPlayTime = now + JITTER_S
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(p.audioCtxDest)
      src.start(p.nextPlayTime)
      p.nextPlayTime += buffer.duration
    } catch { /* one bad buffer isn't fatal */ } finally {
      data.close()
    }
  }

  // ─────────────────────────── Incoming video ───────────────────────────

  private handleVideoPacket(userId: string, meta: VideoPacketMeta, payload: ArrayBuffer): void {
    const p = this.ensurePeer(userId)

    // Gap or first frame → wait for the next keyframe so VP8 has a valid ref.
    if (meta.seq !== p.lastVideoSeq + 1) {
      p.awaitingKey = true
      this.requestRemoteKeyframe(userId, p)
    }
    p.lastVideoSeq = meta.seq
    if (p.awaitingKey && !meta.key) {
      this.requestRemoteKeyframe(userId, p)
      return
    }

    if (!p.videoDecoder || p.videoDecoder.state === 'closed') {
      p.videoDecoder = new VideoDecoder({
        output: (frame) => this.paintFrame(userId, frame),
        error: () => {
          p.awaitingKey = true
          this.requestRemoteKeyframe(userId, p)
        }
      })
      p.videoDecoder.configure({ codec: 'vp8' })
      p.awaitingKey = true
      if (!meta.key) return
    }

    try {
      p.videoDecoder.decode(new EncodedVideoChunk({
        type: meta.key ? 'key' : 'delta',
        timestamp: meta.seq * 33_000,
        data: payload
      }))
      p.awaitingKey = false
    } catch {
      p.awaitingKey = true
      this.requestRemoteKeyframe(userId, p)
    }
  }

  private requestRemoteKeyframe(userId: string, p: PeerState): void {
    const now = performance.now()
    if (now - p.lastKeyframeRequestAt < 800) return
    p.lastKeyframeRequestAt = now
    this.requestKeyframe(userId)
  }

  private paintFrame(userId: string, frame: VideoFrame): void {
    const p = this.peers.get(userId)
    if (!p) { frame.close(); return }
    try {
      if (p.canvas.width !== frame.displayWidth || p.canvas.height !== frame.displayHeight) {
        p.canvas.width = frame.displayWidth
        p.canvas.height = frame.displayHeight
      }
      p.canvasCtx.drawImage(frame, 0, 0)
      if (!p.canvasStream) {
        p.canvasStream = p.canvas.captureStream(30)
        // Emitting the canvas stream separately is fine — the voice store
        // merges audio and video tracks per user.
        this.onRemoteStream?.(userId, p.canvasStream)
      }
    } finally {
      frame.close()
    }
  }

  // ─────────────────────────── Telemetry ───────────────────────────

  private startStatsLoop(): void {
    if (this.statsTimer) return
    this.statsTimer = setInterval(() => {
      this.sendVoicePing()
      const upKbps = Math.round((this.bytesUp * 8) / 1000 / 2)
      const downKbps = Math.round((this.bytesDown * 8) / 1000 / 2)
      this.bytesUp = 0
      this.bytesDown = 0
      this.onStats?.({ rttMs: this.lastRtt, upKbps, downKbps })
    }, 2000)
  }

  private stopStatsLoop(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
    this.lastRtt = null
    this.lastUdpPongAt = 0
    this.onStats?.({ rttMs: null, upKbps: 0, downKbps: 0 })
  }

  private hasFreshUdpVoicePath(): boolean {
    return this.lastUdpPongAt > 0 && performance.now() - this.lastUdpPongAt < 5000
  }

  private sendVoicePing(): void {
    if (!this.roomId) return
    const sentAt = performance.now()
    window.api.signaling.emitVoiceUdpPing(this.roomId, sentAt)
    window.api.signaling.emit('media:ping', sentAt)
  }
}

export const mediaEngine = new MeshMediaEngine()
