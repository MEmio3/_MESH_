export type UdpMediaPacketKind = 'audio' | 'ping' | 'pong'

export interface UdpMediaPacket {
  kind: UdpMediaPacketKind
  header: Record<string, unknown>
  payload: Uint8Array
}

const MAGIC = [0x4d, 0x55, 0x44, 0x50] // MUDP
const VERSION = 1
const HEADER_OFFSET = 8

const kindToCode: Record<UdpMediaPacketKind, number> = {
  audio: 1,
  ping: 2,
  pong: 3
}

const codeToKind: Record<number, UdpMediaPacketKind | undefined> = {
  1: 'audio',
  2: 'ping',
  3: 'pong'
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toUint8Array(payload?: ArrayBuffer | Uint8Array): Uint8Array {
  if (!payload) return new Uint8Array(0)
  if (payload instanceof Uint8Array) {
    return payload
  }
  return new Uint8Array(payload)
}

export function encodeUdpMediaPacket(
  kind: UdpMediaPacketKind,
  header: Record<string, unknown>,
  payload?: ArrayBuffer | Uint8Array
): Uint8Array {
  const headerBytes = encoder.encode(JSON.stringify(header))
  if (headerBytes.byteLength > 0xffff) {
    throw new Error('UDP media header is too large')
  }

  const body = toUint8Array(payload)
  const packet = new Uint8Array(HEADER_OFFSET + headerBytes.byteLength + body.byteLength)
  packet.set(MAGIC, 0)
  packet[4] = VERSION
  packet[5] = kindToCode[kind]
  packet[6] = (headerBytes.byteLength >> 8) & 0xff
  packet[7] = headerBytes.byteLength & 0xff
  packet.set(headerBytes, HEADER_OFFSET)
  packet.set(body, HEADER_OFFSET + headerBytes.byteLength)
  return packet
}

export function decodeUdpMediaPacket(message: Uint8Array): UdpMediaPacket | null {
  if (message.byteLength < HEADER_OFFSET) return null
  if (message[0] !== MAGIC[0] || message[1] !== MAGIC[1] || message[2] !== MAGIC[2] || message[3] !== MAGIC[3]) {
    return null
  }
  if (message[4] !== VERSION) return null

  const kind = codeToKind[message[5]]
  if (!kind) return null

  const headerLength = (message[6] << 8) | message[7]
  const payloadOffset = HEADER_OFFSET + headerLength
  if (payloadOffset > message.byteLength) return null

  try {
    const headerRaw = decoder.decode(message.slice(HEADER_OFFSET, payloadOffset))
    const parsed = JSON.parse(headerRaw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return {
      kind,
      header: parsed as Record<string, unknown>,
      payload: message.slice(payloadOffset)
    }
  } catch {
    return null
  }
}
