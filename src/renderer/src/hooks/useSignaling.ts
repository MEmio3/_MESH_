/**
 * useSignaling — Wires IPC signaling events from the main process into the
 * renderer stores. Media is host-relayed (see lib/media-engine.ts); this hook
 * only tracks room membership and forwards call/DM events.
 */

import { useEffect, useRef, useCallback } from 'react'
import { mediaEngine } from '@/lib/media-engine'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useVoiceStore, addVoiceParticipant } from '@/stores/voice.store'
import { notify } from '@/lib/notify'

export interface SignalingState {
  connect: (serverUrl: string) => Promise<void>
  disconnect: () => Promise<void>
  joinRoom: (roomId: string) => void
  leaveRoom: (roomId?: string) => void
  sendOffer: (targetSocketId: string, offer: RTCSessionDescriptionInit) => void
  sendAnswer: (targetSocketId: string, answer: RTCSessionDescriptionInit) => void
  sendIceCandidate: (targetSocketId: string, candidate: RTCIceCandidateInit) => void
  sendDmMessage: (targetUserId: string, message: string) => void
  sendCallInvite: (targetUserId: string, callData: unknown) => void
  sendCallAccept: (targetUserId: string) => void
  sendCallReject: (targetUserId: string) => void
  sendCallEnd: (targetUserId: string) => void
}

/**
 * Hook that sets up signaling event listeners and returns control methods.
 * Should be called once at the app level (or per active connection context).
 *
 * Callbacks allow consumers (pages, stores) to react to specific events.
 */
export function useSignaling(callbacks?: {
  onConnected?: () => void
  onDisconnected?: (reason: string) => void
  onError?: (message: string) => void
  onUserJoined?: (userId: string, socketId: string, roomId?: string) => void
  onUserLeft?: (userId: string, socketId: string, roomId?: string) => void
  onDmMessage?: (fromUserId: string, message: string) => void
  onCallInvite?: (fromUserId: string, callData: unknown) => void
  onCallAccept?: (fromUserId: string) => void
  onCallReject?: (fromUserId: string) => void
  onCallEnd?: (fromUserId: string) => void
}): SignalingState {
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  // Set up IPC listeners for signaling events from main process
  useEffect(() => {
    const cleanups: (() => void)[] = []

    // Connection events
    cleanups.push(window.api.signaling.onConnected(() => {
      callbacksRef.current?.onConnected?.()
    }))

    cleanups.push(window.api.signaling.onDisconnected((reason: string) => {
      callbacksRef.current?.onDisconnected?.(reason)
    }))

    cleanups.push(window.api.signaling.onError((message: string) => {
      callbacksRef.current?.onError?.(message)
    }))

    // User join/leave in rooms. No peer connections anymore — media flows
    // through the host relay — so joining just means "show them and expect
    // their packets".
    const isCurrentVoiceRoom = (roomId?: string): boolean => {
      if (!roomId?.startsWith('voice:')) return false
      const [, serverId, channelId = 'legacy'] = roomId.split(':')
      const voice = useVoiceStore.getState()
      return voice.isConnected
        && voice.currentServerId === serverId
        && (voice.currentChannelId ?? 'legacy') === channelId
    }

    cleanups.push(window.api.signaling.onUserJoined(async (userId: string, socketId: string, roomId?: string) => {
      callbacksRef.current?.onUserJoined?.(userId, socketId, roomId)
      if (isCurrentVoiceRoom(roomId)) {
        addVoiceParticipant(userId)
      }
      // Someone new can now receive our media. If we're streaming video, push
      // a keyframe right away so their decoder starts immediately instead of
      // waiting up to ~2s for the next periodic one (fixes "stream is live but
      // I can't see it"). Covers both server voice rooms and 1-1 call rooms.
      if (isCurrentVoiceRoom(roomId) || roomId?.startsWith('call:')) {
        mediaEngine.forceKeyframe()
      }
    }))

    cleanups.push(window.api.signaling.onUserLeft((userId: string, _socketId: string, roomId?: string) => {
      callbacksRef.current?.onUserLeft?.(userId, _socketId, roomId)
      if (isCurrentVoiceRoom(roomId) || roomId?.startsWith('call:')) {
        mediaEngine.handleUserLeft(userId)
      }
    }))

    // DM message via signaling relay (fallback when no data channel)
    cleanups.push(window.api.signaling.onDmMessage(async (fromUserId: string, message: string) => {
      if (await window.api.block.isBlocked({ userId: fromUserId })) return
      callbacksRef.current?.onDmMessage?.(fromUserId, message)
    }))

    // Call signaling
    cleanups.push(window.api.signaling.onCallInvite(async (fromUserId: string, callData: unknown) => {
      if (await window.api.block.isBlocked({ userId: fromUserId })) return
      const friend = useFriendsStore.getState().friends.find((f) => f.userId === fromUserId)
      const kind = (callData as { kind?: 'voice' | 'video' } | null)?.kind || 'voice'
      notify({
        type: 'call',
        title: kind === 'video' ? 'Incoming video call' : 'Incoming voice call',
        body: `${friend?.username || 'Someone'} is calling you`,
        route: friend ? `/channels/@me/dm_${fromUserId}` : '/channels/@me',
        force: true
      })
      callbacksRef.current?.onCallInvite?.(fromUserId, callData)
    }))

    cleanups.push(window.api.signaling.onCallAccept((fromUserId: string) => {
      callbacksRef.current?.onCallAccept?.(fromUserId)
    }))

    cleanups.push(window.api.signaling.onCallReject((fromUserId: string) => {
      callbacksRef.current?.onCallReject?.(fromUserId)
    }))

    cleanups.push(window.api.signaling.onCallEnd((fromUserId: string) => {
      callbacksRef.current?.onCallEnd?.(fromUserId)
    }))

    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [])

  const connect = useCallback(async (serverUrl: string) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    await window.api.signaling.connect(serverUrl, identity.userId)
  }, [])

  const disconnect = useCallback(async () => {
    await window.api.signaling.disconnect()
    mediaEngine.leaveRoom()
  }, [])

  const joinRoom = useCallback((roomId: string) => {
    window.api.signaling.emit('join-room', roomId)
  }, [])

  const leaveRoom = useCallback((roomId?: string) => {
    if (roomId) window.api.signaling.emit('leave-room', roomId)
    else window.api.signaling.emit('leave-room')
    mediaEngine.leaveRoom()
  }, [])

  const sendOffer = useCallback((targetSocketId: string, offer: RTCSessionDescriptionInit) => {
    window.api.signaling.emit('offer', targetSocketId, offer)
  }, [])

  const sendAnswer = useCallback((targetSocketId: string, answer: RTCSessionDescriptionInit) => {
    window.api.signaling.emit('answer', targetSocketId, answer)
  }, [])

  const sendIceCandidate = useCallback((targetSocketId: string, candidate: RTCIceCandidateInit) => {
    window.api.signaling.emit('ice-candidate', targetSocketId, candidate)
  }, [])

  const sendDmMessage = useCallback((targetUserId: string, message: string) => {
    window.api.signaling.emit('dm-message', targetUserId, message)
  }, [])

  const sendCallInvite = useCallback((targetUserId: string, callData: unknown) => {
    window.api.signaling.emit('call-invite', targetUserId, callData)
  }, [])

  const sendCallAccept = useCallback((targetUserId: string) => {
    window.api.signaling.emit('call-accept', targetUserId)
  }, [])

  const sendCallReject = useCallback((targetUserId: string) => {
    window.api.signaling.emit('call-reject', targetUserId)
  }, [])

  const sendCallEnd = useCallback((targetUserId: string) => {
    window.api.signaling.emit('call-end', targetUserId)
  }, [])

  return {
    connect,
    disconnect,
    joinRoom,
    leaveRoom,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    sendDmMessage,
    sendCallInvite,
    sendCallAccept,
    sendCallReject,
    sendCallEnd
  }
}
