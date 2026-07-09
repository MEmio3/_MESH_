import { BrowserWindow } from 'electron'
import dgram from 'dgram'
import { decodeVoiceUdpPacket, encodeVoiceUdpPacket } from '../shared/voice-udp-packet'

interface VoiceUdpHost {
  url: string
  hostname: string
  port: number
}

let mainWindow: BrowserWindow | null = null
let udpSocket: dgram.Socket | null = null
let currentUserId = ''
const hosts = new Map<string, VoiceUdpHost>()

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

function parseHost(serverUrl: string): VoiceUdpHost | null {
  const normalized = normalizeUrl(serverUrl)
  if (!normalized) return null

  try {
    const parsed = new URL(normalized)
    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === 'https:'
        ? 443
        : 80
    if (!Number.isFinite(port) || port < 1 || port > 65535) return null
    return {
      url: parsed.origin,
      hostname: parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname,
      port
    }
  } catch {
    return null
  }
}

function toPayloadBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  return null
}

function objectHeader(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function ensureSocket(): dgram.Socket | null {
  if (udpSocket) return udpSocket

  const socket = dgram.createSocket('udp4')
  udpSocket = socket
  socket.on('message', (message) => {
    const packet = decodeVoiceUdpPacket(message)
    if (!packet) return

    if (packet.kind === 'audio') {
      const fromUserId = asString(packet.header.fromUserId)
      if (!fromUserId) return
      sendToRenderer('signaling:media:audio', fromUserId, objectHeader(packet.header.meta), packet.payload)
      return
    }

    if (packet.kind === 'pong') {
      const sentAt = typeof packet.header.sentAt === 'number' ? packet.header.sentAt : null
      if (sentAt !== null) sendToRenderer('signaling:media:pong', sentAt, 'udp')
    }
  })
  socket.on('error', (err) => {
    console.warn('[voice-udp-client] socket error:', err.message)
  })
  socket.unref()
  return socket
}

function sendPacket(host: VoiceUdpHost, packet: Uint8Array): boolean {
  const socket = ensureSocket()
  if (!socket) return false
  socket.send(packet, host.port, host.hostname, (err) => {
    if (err) console.warn('[voice-udp-client] send failed:', host.url, err.message)
  })
  return true
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function configureHost(serverUrl: string, userId: string): boolean {
  const host = parseHost(serverUrl)
  if (!host || !userId) return false
  currentUserId = userId
  hosts.set(host.url, host)
  ensureSocket()
  return true
}

export function removeHost(serverUrl: string): void {
  const host = parseHost(serverUrl)
  if (host) hosts.delete(host.url)
  if (hosts.size === 0 && udpSocket) {
    try { udpSocket.close() } catch { /* ignore */ }
    udpSocket = null
  }
}

export function reset(): void {
  hosts.clear()
  currentUserId = ''
  if (udpSocket) {
    try { udpSocket.close() } catch { /* ignore */ }
    udpSocket = null
  }
}

export function sendAudio(serverUrl: string, roomId: string, meta: unknown, payload: unknown): boolean {
  const host = hosts.get(parseHost(serverUrl)?.url ?? '')
  const bytes = toPayloadBytes(payload)
  if (!host || !currentUserId || !roomId || !bytes) return false

  const packet = encodeVoiceUdpPacket('audio', {
    roomId,
    userId: currentUserId,
    meta: objectHeader(meta)
  }, bytes)
  return sendPacket(host, packet)
}

export function sendPing(serverUrl: string, roomId: string, sentAt: number): boolean {
  const host = hosts.get(parseHost(serverUrl)?.url ?? '')
  if (!host || !currentUserId || !roomId || typeof sentAt !== 'number') return false
  const packet = encodeVoiceUdpPacket('ping', {
    roomId,
    userId: currentUserId,
    sentAt
  })
  return sendPacket(host, packet)
}
