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
  lastVideoSeq: number
  emittedAudio: boolean
}

const AUDIO_TIMESLICE_US = 20_000 // Opus frame duration the encoder targets
const JITTER_S = 0.09             // playback cushion — ~90ms feels instant on LAN
const KEYFRAME_INTERVAL = 60      // video keyframe every N frames (~2s at 30fps)

class MeshMediaEngine {
  // ── Callbacks (assigned by the store wiring, composed like webrtcManager's) ──
  onRemoteStream: ((userId: string, stream: MediaStream) => void) | null = null
  onParticipantVoice: ((userId: string) => void) | null = null
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

  // ── Incoming state (per remote user) ──
  private peers = new Map<string, PeerState>()

  private playCtx: AudioContext | null = null
  private listenersReady = false

  // ── Telemetry ──
  private bytesUp = 0
  private bytesDown = 0
  private lastRtt: number | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null

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
    window.api.signaling.onMediaPong((sentAt) => {
      this.lastRtt = Math.max(0, Math.round(performance.now() - sentAt))
    })
  }

  // ─────────────────────────── Session ───────────────────────────

  joinRoom(roomId: string): void {
    this.init()
    this.roomId = roomId
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
  }

  // ─────────────────────────── Microphone ───────────────────────────

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
            encoder.encode(value)
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
    window.api.signaling.emit('media:audio', this.roomId, meta, buf)
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
  }

  /** Mute = simply stop shipping packets; capture keeps running. */
  setMicEnabled(enabled: boolean): void {
    this.micEnabled = enabled
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
              encoder.encode(value, { keyFrame: frameCount % KEYFRAME_INTERVAL === 0 })
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
      for (let ch = 0; ch < data.numberOfChannels; ch++) {
        const arr = new Float32Array(data.numberOfFrames)
        data.copyTo(arr, { planeIndex: ch, format: 'f32-planar' })
        buffer.copyToChannel(arr, ch)
      }
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
    if (meta.seq !== p.lastVideoSeq + 1) p.awaitingKey = true
    p.lastVideoSeq = meta.seq
    if (p.awaitingKey && !meta.key) return

    if (!p.videoDecoder || p.videoDecoder.state === 'closed') {
      p.videoDecoder = new VideoDecoder({
        output: (frame) => this.paintFrame(userId, frame),
        error: () => { p.awaitingKey = true }
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
    }
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
      window.api.signaling.emit('media:ping', performance.now())
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
    this.onStats?.({ rttMs: null, upKbps: 0, downKbps: 0 })
  }
}

export const mediaEngine = new MeshMediaEngine()
