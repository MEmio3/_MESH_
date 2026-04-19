/**
 * useSignaling — Wires IPC signaling events from main process to the WebRTC manager.
 *
 * Listens for signaling events forwarded from main process socket-client,
 * drives the webrtcManager to create peer connections, handle offers/answers/ICE.
 * Also exposes connect/disconnect/emit helpers for the renderer.
 */

import { useEffect, useRef, useCallback } from 'react'
import { webrtcManager } from '@/lib/webrtc'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import { notify } from '@/lib/notify'

export interface SignalingState {
  connect: (serverUrl: string) => Promise<void>
  disconnect: () => Promise<void>
  joinRoom: (roomId: string) => void
  leaveRoom: () => void
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
  onUserJoined?: (userId: string, socketId: string) => void
  onUserLeft?: (userId: string, socketId: string) => void
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

    // User join/leave in rooms
    cleanups.push(window.api.signaling.onUserJoined(async (userId: string, socketId: string) => {
      callbacksRef.current?.onUserJoined?.(userId, socketId)

      // Create the peer connection only. The manual createOffer call was
      // removed because addTrack inside createPeerConnection already fires
      // onnegotiationneeded, which creates and sends the offer exactly once.
      // Firing a second manual offer in parallel produced the voice-channel
      // double-offer bug: two offers hit the remote peer simultaneously,
      // setRemoteDescription collided, the PC aborted, no audio/video.
      await webrtcManager.createPeerConnection(userId, socketId, true)
    }))

    cleanups.push(window.api.signaling.onUserLeft((userId: string, _socketId: string) => {
      callbacksRef.current?.onUserLeft?.(userId, _socketId)
      webrtcManager.closePeer(userId)
    }))

    // WebRTC signaling: offer
    cleanups.push(window.api.signaling.onOffer(async (fromSocketId: string, offer: RTCSessionDescriptionInit, fromUserId: string) => {
      const answer = await webrtcManager.handleOffer(fromSocketId, offer, fromUserId)
      if (answer) {
        window.api.signaling.emit('answer', fromSocketId, answer)
      }
    }))

    // WebRTC signaling: answer
    cleanups.push(window.api.signaling.onAnswer(async (fromSocketId: string, answer: RTCSessionDescriptionInit) => {
      await webrtcManager.handleAnswer(fromSocketId, answer)
    }))

    // WebRTC signaling: ICE candidate
    cleanups.push(window.api.signaling.onIceCandidate(async (fromSocketId: string, candidate: RTCIceCandidateInit) => {
      await webrtcManager.handleIceCandidate(fromSocketId, candidate)
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

    // Wire webrtcManager ICE candidate callback to emit via signaling
    webrtcManager.onIceCandidate = (socketId, candidate) => {
      window.api.signaling.emit('ice-candidate', socketId, candidate)
    }

    // Mid-call renegotiation — when tracks are added/removed, the PC fires
    // onnegotiationneeded; the manager creates a fresh offer and asks us
    // to forward it to the remote peer.
    webrtcManager.onRenegotiate = (socketId, offer) => {
      window.api.signaling.emit('offer', socketId, offer)
    }

    return () => {
      cleanups.forEach((fn) => fn())
      webrtcManager.onIceCandidate = null
      webrtcManager.onRenegotiate = null
    }
  }, [])

  const connect = useCallback(async (serverUrl: string) => {
    const identity = useIdentityStore.getState().identity
    if (!identity) return
    // Give Perfect Negotiation our userId so it can compute politeness
    // against remote peers on new connections.
    webrtcManager.setSelfUserId(identity.userId)
    await window.api.signaling.connect(serverUrl, identity.userId)
  }, [])

  const disconnect = useCallback(async () => {
    await window.api.signaling.disconnect()
    webrtcManager.closeAll()
  }, [])

  const joinRoom = useCallback((roomId: string) => {
    window.api.signaling.emit('join-room', roomId)
  }, [])

  const leaveRoom = useCallback(() => {
    window.api.signaling.emit('leave-room')
    webrtcManager.closeAll()
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
