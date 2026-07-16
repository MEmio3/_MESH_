import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { io, type Socket } from 'socket.io-client'
import { createSignalingInstance } from '../src/server/signaling'
import { decodeVoiceUdpPacket, encodeVoiceUdpPacket, type VoiceUdpPacketKind } from '../src/shared/voice-udp-packet'

const port = 43000 + Math.floor(Math.random() * 1000)
const roomId = 'voice:srv_dual_stack_test:voice'
const host = createSignalingInstance(port, { appVersion: 'dual-stack-test' })

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket.IO connection timed out')), 5000)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function bindUdp(socket: dgram.Socket, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, address, () => {
      socket.removeListener('error', reject)
      resolve()
    })
  })
}

function waitForPacket(socket: dgram.Socket, kind: VoiceUdpPacketKind, fromUserId?: string): Promise<ReturnType<typeof decodeVoiceUdpPacket>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener('message', onMessage)
      reject(new Error(`Timed out waiting for ${kind}${fromUserId ? ` from ${fromUserId}` : ''}`))
    }, 4000)
    const onMessage = (message: Buffer): void => {
      const packet = decodeVoiceUdpPacket(message)
      if (!packet || packet.kind !== kind) return
      if (fromUserId && packet.header.fromUserId !== fromUserId) return
      clearTimeout(timer)
      socket.removeListener('message', onMessage)
      resolve(packet)
    }
    socket.on('message', onMessage)
  })
}

async function main(): Promise<void> {
  const udp4 = dgram.createSocket('udp4')
  const udp6 = dgram.createSocket('udp6')
  const socket4 = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], autoConnect: false })
  const socket6 = io(`http://[::1]:${port}`, { transports: ['websocket'], autoConnect: false })

  try {
    await host.start()
    const connected4 = waitForConnect(socket4)
    const connected6 = waitForConnect(socket6)
    socket4.connect()
    socket6.connect()
    await Promise.all([connected4, connected6])
    socket4.emit('register-user', 'usr_ipv4_test')
    socket6.emit('register-user', 'usr_ipv6_test')
    socket4.emit('join-room', roomId)
    socket6.emit('join-room', roomId)
    await new Promise((resolve) => setTimeout(resolve, 100))

    await Promise.all([bindUdp(udp4, '127.0.0.1'), bindUdp(udp6, '::1')])
    const pong4 = waitForPacket(udp4, 'pong')
    const pong6 = waitForPacket(udp6, 'pong')
    udp4.send(encodeVoiceUdpPacket('ping', { roomId, userId: 'usr_ipv4_test', sentAt: 1 }), port, '127.0.0.1')
    udp6.send(encodeVoiceUdpPacket('ping', { roomId, userId: 'usr_ipv6_test', sentAt: 2 }), port, '::1')
    await Promise.all([pong4, pong6])

    const receivedByIpv6 = waitForPacket(udp6, 'audio', 'usr_ipv4_test')
    udp4.send(encodeVoiceUdpPacket('audio', {
      roomId,
      userId: 'usr_ipv4_test',
      meta: { sequence: 1 }
    }, new Uint8Array([4, 6, 4, 6])), port, '127.0.0.1')
    const packet6 = await receivedByIpv6
    assert.deepEqual([...packet6!.payload], [4, 6, 4, 6])

    const receivedByIpv4 = waitForPacket(udp4, 'audio', 'usr_ipv6_test')
    udp6.send(encodeVoiceUdpPacket('audio', {
      roomId,
      userId: 'usr_ipv6_test',
      meta: { sequence: 2 }
    }, new Uint8Array([6, 4, 6, 4])), port, '::1')
    const packet4 = await receivedByIpv4
    assert.deepEqual([...packet4!.payload], [6, 4, 6, 4])

    console.log('Dual-stack signaling and IPv4 <-> IPv6 UDP voice relay verified.')
  } finally {
    socket4.disconnect()
    socket6.disconnect()
    udp4.close()
    udp6.close()
    await host.stop()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
