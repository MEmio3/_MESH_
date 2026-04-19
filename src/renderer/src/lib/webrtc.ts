/**
 * WebRTC Peer Connection Manager.
 *
 * Runs in the renderer process using the browser's RTCPeerConnection API.
 * Signaling goes through the main process socket connection via IPC.
 *
 * iceServers is empty [] by default — pure P2P direct connection.
 * TURN servers from the relay pool are added only when the user's
 * ICE strategy is 'relay-fallback' or 'relay-only'.
 */

export interface FileTransferMeta {
  fileId: string
  fileName: string
  fileSize: number
  fileType: string
  totalChunks: number
}

const FILE_CHUNK_SIZE = 64 * 1024 // 64KB chunks

export interface PeerConnection {
  userId: string
  socketId: string
  pc: RTCPeerConnection
  dataChannel: RTCDataChannel | null
  // Perfect Negotiation state (per-peer).
  makingOffer: boolean
  ignoreOffer: boolean
  polite: boolean
}

export type IceStrategy = 'p2p-first' | 'relay-fallback' | 'relay-only'

class WebRTCManager {
  private peers: Map<string, PeerConnection> = new Map()
  private localAudioStream: MediaStream | null = null
  private localVideoStream: MediaStream | null = null
  private localScreenStream: MediaStream | null = null

  // Our own userId — required to compute politeness for Perfect Negotiation.
  // Set once at app init via setSelfUserId(); politeness = selfId < remoteId.
  private selfUserId: string | null = null

  // Empty by default — pure P2P, no external STUN/TURN
  private iceServers: RTCIceServer[] = []
  private iceTransportPolicy: RTCIceTransportPolicy = 'all'

  // File transfer state: accumulates chunks per fileId
  private fileChunks: Map<string, { meta: FileTransferMeta; chunks: ArrayBuffer[]; received: number }> = new Map()

  // Callbacks — set by consumers (useSignaling hook, voice store, etc.)
  onRemoteStream: ((userId: string, stream: MediaStream) => void) | null = null
  onRemoteStreamRemoved: ((userId: string) => void) | null = null
  onDataMessage: ((userId: string, message: string) => void) | null = null
  onFileReceived: ((userId: string, meta: FileTransferMeta, data: ArrayBuffer) => void) | null = null
  onFileProgress: ((userId: string, fileId: string, progress: number) => void) | null = null
  onPeerConnected: ((userId: string) => void) | null = null
  onPeerDisconnected: ((userId: string) => void) | null = null
  // Fires each time a data channel to `userId` transitions to 'open'.
  // Consumers use this to push payloads that require a ready channel — e.g.
  // the avatar store pushes the self image to the new peer so profile
  // pictures appear without the user having to re-upload.
  onDataChannelReady: ((userId: string) => void) | null = null
  onIceCandidate: ((socketId: string, candidate: RTCIceCandidateInit) => void) | null = null
  // Called whenever an existing peer connection needs to renegotiate (e.g. a
  // new media track was added mid-call). Consumer should emit the offer via
  // signaling and the remote side will answer.
  onRenegotiate: ((socketId: string, offer: RTCSessionDescriptionInit) => void) | null = null

  /**
   * Configure ICE servers from relay pool.
   * Called when relay list updates or ICE strategy changes.
   */
  setIceConfig(servers: RTCIceServer[], strategy: IceStrategy): void {
    this.iceServers = servers
    this.iceTransportPolicy = strategy === 'relay-only' ? 'relay' : 'all'
  }

  /**
   * Set our own userId for Perfect Negotiation politeness comparison.
   * Must be called before createPeerConnection/handleOffer for new peers —
   * otherwise the manager defaults to impolite (safe fallback: no glare
   * recovery but also no incorrect rollback).
   */
  setSelfUserId(id: string): void {
    this.selfUserId = id
  }

  /**
   * Create a new peer connection for a specific user.
   * isInitiator = true means we create the offer (we joined first or initiated).
   */
  async createPeerConnection(userId: string, socketId: string, isInitiator: boolean): Promise<RTCPeerConnection> {
    // Close existing connection to this user if any
    this.closePeer(userId)

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.iceTransportPolicy
    })

    // Perfect Negotiation politeness: lexicographic userId compare.
    // The peer with the smaller userId is polite (yields on collision).
    // If selfUserId unknown, default to impolite.
    const polite = this.selfUserId !== null && this.selfUserId < userId

    const peer: PeerConnection = {
      userId,
      socketId,
      pc,
      dataChannel: null,
      makingOffer: false,
      ignoreOffer: false,
      polite
    }
    this.peers.set(userId, peer)

    // ICE candidate handler — send via signaling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onIceCandidate?.(socketId, event.candidate.toJSON())
      }
    }

    // Track handler — remote audio/video
    pc.ontrack = (event) => {
      if (event.streams[0]) {
        this.onRemoteStream?.(userId, event.streams[0])
      }
    }

    // Connection state
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.onPeerConnected?.(userId)
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.onPeerDisconnected?.(userId)
      }
    }

    // Perfect Negotiation: onnegotiationneeded always attempts an offer,
    // guarded only by the per-peer `makingOffer` flag. Glare resolution
    // lives in handleOffer (polite rolls back, impolite ignores), not here.
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true
        // setLocalDescription() with no args auto-creates the right SDP
        // (offer in stable state, answer otherwise) — spec-compliant and
        // the cleanest way to avoid races between createOffer and srd.
        await pc.setLocalDescription()
        if (pc.localDescription) {
          this.onRenegotiate?.(peer.socketId, pc.localDescription.toJSON())
        }
      } catch (err) {
        console.error('[webrtc] negotiationneeded failed:', err)
      } finally {
        peer.makingOffer = false
      }
    }

    // Add local tracks if available
    if (this.localAudioStream) {
      for (const track of this.localAudioStream.getTracks()) {
        pc.addTrack(track, this.localAudioStream)
      }
    }
    if (this.localVideoStream) {
      for (const track of this.localVideoStream.getTracks()) {
        pc.addTrack(track, this.localVideoStream)
      }
    }
    if (this.localScreenStream) {
      for (const track of this.localScreenStream.getTracks()) {
        pc.addTrack(track, this.localScreenStream)
      }
    }

    // Data channel for text messaging
    if (isInitiator) {
      const dc = pc.createDataChannel('mesh-data', { ordered: true })
      this.setupDataChannel(dc, userId)
      peer.dataChannel = dc
    } else {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(event.channel, userId)
        peer.dataChannel = event.channel
      }
    }

    return pc
  }

  private setupDataChannel(dc: RTCDataChannel, userId: string): void {
    dc.binaryType = 'arraybuffer'
    dc.onopen = () => {
      this.onDataChannelReady?.(userId)
    }
    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // Try to detect file-transfer control messages
        try {
          const parsed = JSON.parse(event.data)
          if (parsed.type === 'file-meta') {
            const meta: FileTransferMeta = parsed.meta
            this.fileChunks.set(meta.fileId, { meta, chunks: [], received: 0 })
            return
          }
          if (parsed.type === 'file-end') {
            const entry = this.fileChunks.get(parsed.fileId)
            if (entry) {
              const totalSize = entry.chunks.reduce((s, c) => s + c.byteLength, 0)
              const merged = new ArrayBuffer(totalSize)
              const view = new Uint8Array(merged)
              let offset = 0
              for (const chunk of entry.chunks) {
                view.set(new Uint8Array(chunk), offset)
                offset += chunk.byteLength
              }
              this.fileChunks.delete(parsed.fileId)
              this.onFileReceived?.(userId, entry.meta, merged)
            }
            return
          }
        } catch {
          // Not JSON — regular text message
        }
        this.onDataMessage?.(userId, event.data)
      } else if (event.data instanceof ArrayBuffer) {
        // Binary chunk — find active file transfer
        // The first 36 bytes are the fileId (UUID), rest is chunk data
        const headerView = new Uint8Array(event.data, 0, 36)
        const fileId = new TextDecoder().decode(headerView)
        const chunkData = event.data.slice(36)
        const entry = this.fileChunks.get(fileId)
        if (entry) {
          entry.chunks.push(chunkData)
          entry.received += chunkData.byteLength
          const progress = Math.min(100, Math.round((entry.received / entry.meta.fileSize) * 100))
          this.onFileProgress?.(userId, fileId, progress)
        }
      }
    }
  }

  /**
   * Create an offer and return it for sending via signaling.
   * Uses Perfect Negotiation's makingOffer flag so a concurrent
   * onnegotiationneeded doesn't double-create.
   */
  async createOffer(userId: string): Promise<RTCSessionDescriptionInit | null> {
    const peer = this.peers.get(userId)
    if (!peer) return null
    try {
      peer.makingOffer = true
      await peer.pc.setLocalDescription()
      return peer.pc.localDescription?.toJSON() ?? null
    } finally {
      peer.makingOffer = false
    }
  }

  /**
   * Handle an incoming offer using the Perfect Negotiation pattern.
   *
   * Collision detection: an offer collides if we're mid-offer (makingOffer)
   * or our signalingState isn't 'stable'. On collision, the impolite peer
   * ignores the offer and the polite peer implicitly rolls back its own
   * local offer by accepting the remote one (spec-compliant setRemoteDescription
   * handles the rollback atomically).
   *
   * Reuses existing RTCPeerConnection mid-call to keep tracks intact.
   */
  async handleOffer(socketId: string, offer: RTCSessionDescriptionInit, userId: string): Promise<RTCSessionDescriptionInit | null> {
    let peer = this.peers.get(userId)
    if (!peer) {
      await this.createPeerConnection(userId, socketId, false)
      peer = this.peers.get(userId)
      if (!peer) return null
    } else {
      // Keep socketId current in case the remote reconnected
      peer.socketId = socketId
    }
    const pc = peer.pc

    const offerCollision = peer.makingOffer || pc.signalingState !== 'stable'
    peer.ignoreOffer = !peer.polite && offerCollision
    if (peer.ignoreOffer) {
      // Impolite + collision → drop remote offer. Our own offer wins.
      return null
    }

    try {
      // setRemoteDescription on a collision implicitly rolls back the local
      // offer (modern spec). Then answer.
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      await pc.setLocalDescription()
      return pc.localDescription?.toJSON() ?? null
    } catch (err) {
      console.error('[webrtc] handleOffer failed:', err)
      return null
    }
  }

  /**
   * Handle an incoming answer.
   */
  async handleAnswer(socketId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    for (const peer of this.peers.values()) {
      if (peer.socketId === socketId) {
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(answer))
        } catch (err) {
          console.error('[webrtc] handleAnswer failed:', err)
        }
        return
      }
    }
  }

  /**
   * Handle an incoming ICE candidate. Candidates arriving after an ignored
   * offer are swallowed — they belong to a negotiation that never happened
   * from our side.
   */
  async handleIceCandidate(socketId: string, candidate: RTCIceCandidateInit): Promise<void> {
    for (const peer of this.peers.values()) {
      if (peer.socketId === socketId) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (err) {
          if (!peer.ignoreOffer) {
            console.error('[webrtc] addIceCandidate failed:', err)
          }
        }
        return
      }
    }
  }

  // ── Media Controls ──

  async startAudio(deviceId?: string): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = deviceId
      ? { audio: { deviceId: { exact: deviceId } } }
      : { audio: true }
    const raw = await navigator.mediaDevices.getUserMedia(constraints)
    // Route through a Web Audio gain node so input volume is adjustable.
    this.localAudioStream = this.wrapWithInputGain(raw)
    // Add tracks to all existing peers
    for (const peer of this.peers.values()) {
      for (const track of this.localAudioStream.getTracks()) {
        peer.pc.addTrack(track, this.localAudioStream)
      }
    }
    return this.localAudioStream
  }

  stopAudio(): void {
    if (this.localAudioStream) {
      for (const track of this.localAudioStream.getTracks()) {
        track.stop()
      }
      this.localAudioStream = null
    }
    if (this.rawAudioStream) {
      for (const track of this.rawAudioStream.getTracks()) track.stop()
      this.rawAudioStream = null
    }
    try { this.inputGainNode?.disconnect() } catch { /* ignore */ }
    try { this.inputSourceNode?.disconnect() } catch { /* ignore */ }
    this.inputGainNode = null
    this.inputSourceNode = null
  }

  /** True once a local microphone stream has been captured. */
  hasLocalAudio(): boolean {
    return !!this.localAudioStream
  }

  /**
   * Set input volume (0..1 linear gain). Persists across replaceAudioDevice
   * because we reuse the same `GainNode`.
   */
  setInputGain(gain: number): void {
    this.inputGainValue = Math.max(0, Math.min(2, gain))
    if (this.inputGainNode) this.inputGainNode.gain.value = this.inputGainValue
  }

  /**
   * Wrap a raw mic MediaStream in a Web Audio graph so input volume can be
   * scaled independently of the OS-level capture gain. Returns a MediaStream
   * whose audio track is the gain-adjusted output.
   */
  private rawAudioStream: MediaStream | null = null
  private inputAudioCtx: AudioContext | null = null
  private inputSourceNode: MediaStreamAudioSourceNode | null = null
  private inputGainNode: GainNode | null = null
  private inputGainValue = 1
  private wrapWithInputGain(raw: MediaStream): MediaStream {
    try {
      // Tear down previous graph if present.
      try { this.inputGainNode?.disconnect() } catch { /* ignore */ }
      try { this.inputSourceNode?.disconnect() } catch { /* ignore */ }
      if (this.rawAudioStream) {
        for (const t of this.rawAudioStream.getTracks()) t.stop()
      }
      this.rawAudioStream = raw

      if (!this.inputAudioCtx) this.inputAudioCtx = new AudioContext()
      const ctx = this.inputAudioCtx
      const src = ctx.createMediaStreamSource(raw)
      const gain = ctx.createGain()
      gain.gain.value = this.inputGainValue
      const dst = ctx.createMediaStreamDestination()
      src.connect(gain).connect(dst)
      this.inputSourceNode = src
      this.inputGainNode = gain
      return dst.stream
    } catch (err) {
      console.warn('Input gain pipeline failed, using raw stream:', err)
      this.rawAudioStream = null
      return raw
    }
  }

  setAudioEnabled(enabled: boolean): void {
    if (this.localAudioStream) {
      for (const track of this.localAudioStream.getTracks()) {
        track.enabled = enabled
      }
    }
  }

  /**
   * Swap the microphone mid-call. Grabs a new MediaStream from the given
   * deviceId, replaces the existing outbound audio track on every peer
   * RTCRtpSender via `RTCRtpSender.replaceTrack` (no renegotiation), then
   * releases the old tracks.
   */
  async replaceAudioDevice(deviceId?: string): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = deviceId
      ? { audio: { deviceId: { exact: deviceId } } }
      : { audio: true }
    const raw = await navigator.mediaDevices.getUserMedia(constraints)
    // Re-route through the same gain graph so input volume is preserved.
    const next = this.wrapWithInputGain(raw)
    const newTrack = next.getAudioTracks()[0] ?? null
    for (const peer of this.peers.values()) {
      const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'audio')
      if (sender && newTrack) {
        try { await sender.replaceTrack(newTrack) } catch { /* ignore */ }
      } else if (newTrack) {
        peer.pc.addTrack(newTrack, next)
      }
    }
    // Stop the previous post-gain stream's tracks (raw tracks already stopped
    // by wrapWithInputGain when it replaced rawAudioStream).
    if (this.localAudioStream) {
      for (const t of this.localAudioStream.getTracks()) t.stop()
    }
    this.localAudioStream = next
    return next
  }

  /** Same as replaceAudioDevice but for the camera. */
  async replaceVideoDevice(deviceId?: string): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = deviceId
      ? { video: { deviceId: { exact: deviceId } } }
      : { video: true }
    const next = await navigator.mediaDevices.getUserMedia(constraints)
    const newTrack = next.getVideoTracks()[0] ?? null
    for (const peer of this.peers.values()) {
      const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'video')
      if (sender && newTrack) {
        try { await sender.replaceTrack(newTrack) } catch { /* ignore */ }
      } else if (newTrack) {
        peer.pc.addTrack(newTrack, next)
      }
    }
    if (this.localVideoStream) {
      for (const t of this.localVideoStream.getTracks()) t.stop()
    }
    this.localVideoStream = next
    return next
  }

  async startVideo(deviceId?: string): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = deviceId
      ? { video: { deviceId: { exact: deviceId } } }
      : { video: true }
    this.localVideoStream = await navigator.mediaDevices.getUserMedia(constraints)
    for (const peer of this.peers.values()) {
      for (const track of this.localVideoStream.getTracks()) {
        peer.pc.addTrack(track, this.localVideoStream)
      }
    }
    return this.localVideoStream
  }

  stopVideo(): void {
    if (this.localVideoStream) {
      for (const track of this.localVideoStream.getTracks()) {
        track.stop()
      }
      this.localVideoStream = null
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    })
    for (const peer of this.peers.values()) {
      for (const track of this.localScreenStream.getTracks()) {
        peer.pc.addTrack(track, this.localScreenStream)
      }
    }
    // Handle user stopping screen share via browser UI
    this.localScreenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.stopScreenShare()
    })
    return this.localScreenStream
  }

  stopScreenShare(): void {
    if (this.localScreenStream) {
      for (const track of this.localScreenStream.getTracks()) {
        track.stop()
      }
      this.localScreenStream = null
    }
  }

  /**
   * Attach a pre-built screen-share stream (obtained externally — e.g. the
   * StreamPickerModal using chromeMediaSource constraints on a specific
   * desktopCapturer source). Adds tracks to all current peer connections
   * and closes any previous screen stream.
   */
  async attachScreenStream(stream: MediaStream): Promise<void> {
    // Close previous screen stream if any
    if (this.localScreenStream) {
      for (const track of this.localScreenStream.getTracks()) {
        track.stop()
      }
      this.localScreenStream = null
    }
    this.localScreenStream = stream
    for (const peer of this.peers.values()) {
      for (const track of stream.getTracks()) {
        peer.pc.addTrack(track, stream)
      }
    }
  }

  /**
   * Attach a pre-built camera stream (obtained externally — e.g. via the
   * StreamPickerModal with a chosen deviceId + quality). Adds tracks to all
   * current peer connections and closes any previous camera stream.
   */
  async attachVideoStream(stream: MediaStream): Promise<void> {
    if (this.localVideoStream) {
      for (const track of this.localVideoStream.getTracks()) {
        track.stop()
      }
      this.localVideoStream = null
    }
    this.localVideoStream = stream
    for (const peer of this.peers.values()) {
      for (const track of stream.getTracks()) {
        peer.pc.addTrack(track, stream)
      }
    }
  }

  /**
   * Send a text message over a data channel to a specific user.
   */
  sendDataMessage(userId: string, message: string): boolean {
    const peer = this.peers.get(userId)
    if (peer?.dataChannel?.readyState === 'open') {
      peer.dataChannel.send(message)
      return true
    }
    return false
  }

  /**
   * Send a file over the data channel to a specific user.
   * Splits into 64KB chunks with fileId header for reassembly.
   */
  async sendFile(userId: string, fileId: string, fileName: string, fileSize: number, fileType: string, base64Data: string): Promise<boolean> {
    const peer = this.peers.get(userId)
    if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') return false

    const dc = peer.dataChannel
    const buffer = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0)).buffer
    const totalChunks = Math.ceil(buffer.byteLength / FILE_CHUNK_SIZE)

    // Send metadata
    const meta: FileTransferMeta = { fileId, fileName, fileSize, fileType, totalChunks }
    dc.send(JSON.stringify({ type: 'file-meta', meta }))

    // Send chunks with fileId header (36 bytes) prepended
    const encoder = new TextEncoder()
    const fileIdBytes = encoder.encode(fileId.padEnd(36, '\0').slice(0, 36))

    for (let i = 0; i < totalChunks; i++) {
      const start = i * FILE_CHUNK_SIZE
      const end = Math.min(start + FILE_CHUNK_SIZE, buffer.byteLength)
      const chunk = buffer.slice(start, end)

      const packet = new ArrayBuffer(36 + chunk.byteLength)
      new Uint8Array(packet).set(fileIdBytes, 0)
      new Uint8Array(packet).set(new Uint8Array(chunk), 36)

      // Wait if buffered amount is high (backpressure)
      while (dc.bufferedAmount > 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 50))
      }
      dc.send(packet)
    }

    // Send end marker
    dc.send(JSON.stringify({ type: 'file-end', fileId }))
    return true
  }

  /**
   * Return the list of userIds with an open data channel.
   */
  connectedPeerIds(): string[] {
    const out: string[] = []
    for (const [userId, peer] of this.peers) {
      if (peer.dataChannel?.readyState === 'open') out.push(userId)
    }
    return out
  }

  /**
   * Broadcast a text message to all connected peers.
   */
  broadcastDataMessage(message: string): void {
    for (const peer of this.peers.values()) {
      if (peer.dataChannel?.readyState === 'open') {
        peer.dataChannel.send(message)
      }
    }
  }

  /**
   * Close a specific peer connection.
   */
  closePeer(userId: string): void {
    const peer = this.peers.get(userId)
    if (peer) {
      peer.dataChannel?.close()
      peer.pc.close()
      this.peers.delete(userId)
      this.onRemoteStreamRemoved?.(userId)
    }
  }

  /**
   * Close all peer connections and stop all media.
   */
  closeAll(): void {
    for (const userId of this.peers.keys()) {
      this.closePeer(userId)
    }
    this.stopAudio()
    this.stopVideo()
    this.stopScreenShare()
  }

  /**
   * Get all currently connected peer user IDs.
   */
  getConnectedPeers(): string[] {
    return [...this.peers.keys()]
  }

  /**
   * Check if we have a data channel connection to a user.
   */
  hasDataChannel(userId: string): boolean {
    return this.peers.get(userId)?.dataChannel?.readyState === 'open'
  }

  /**
   * Expose the local video/screen stream so the renderer can render self-preview.
   */
  getLocalVideoStream(): MediaStream | null {
    return this.localVideoStream
  }
  getLocalScreenStream(): MediaStream | null {
    return this.localScreenStream
  }
}

// Singleton instance
export const webrtcManager = new WebRTCManager()
