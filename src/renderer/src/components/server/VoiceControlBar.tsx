import { Mic, MicOff, Headphones, HeadphoneOff, Monitor, Camera, CameraOff, PhoneOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/Tooltip'
import { useVoiceStore } from '@/stores/voice.store'

function VoiceControlBar(): JSX.Element {
  const {
    isMuted,
    isDeafened,
    isScreenSharing,
    isCameraOn,
    toggleMute,
    toggleDeafen,
    openPicker,
    leaveRoom,
    stopStream
  } = useVoiceStore()

  const isStreaming = isScreenSharing || isCameraOn

  const handleShareClick = (): void => {
    if (isStreaming) {
      stopStream()
    } else {
      openPicker('applications')
    }
  }

  const handleCameraClick = (): void => {
    if (isCameraOn) {
      stopStream()
    } else {
      openPicker('camera')
    }
  }

  return (
    <>
      <div className="flex h-16 items-center justify-center gap-3 border-t border-mesh-border bg-mesh-bg-primary px-4" data-testid="voice-control-bar">
        <VoiceButton
          tooltip={isMuted ? 'Unmute' : 'Mute'}
          active={!isMuted}
          danger={isMuted}
          onClick={toggleMute}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </VoiceButton>

        <VoiceButton
          tooltip={isDeafened ? 'Undeafen' : 'Deafen'}
          active={!isDeafened}
          danger={isDeafened}
          onClick={toggleDeafen}
        >
          {isDeafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
        </VoiceButton>

        <VoiceButton
          tooltip={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
          active={isScreenSharing}
          streaming={isScreenSharing}
          onClick={handleShareClick}
        >
          <Monitor className="h-5 w-5" />
        </VoiceButton>

        <VoiceButton
          tooltip={isCameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
          active={isCameraOn}
          streaming={isCameraOn}
          onClick={handleCameraClick}
        >
          {isCameraOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
        </VoiceButton>

        <div className="w-px h-8 bg-mesh-border mx-1" />

        <VoiceButton tooltip="Disconnect" danger onClick={leaveRoom}>
          <PhoneOff className="h-5 w-5" />
        </VoiceButton>
      </div>
    </>
  )
}

interface VoiceButtonProps {
  tooltip: string
  active?: boolean
  danger?: boolean
  streaming?: boolean
  onClick: () => void
  children: React.ReactNode
}

function VoiceButton({
  tooltip,
  active,
  danger,
  streaming,
  onClick,
  children
}: VoiceButtonProps): JSX.Element {
  return (
    <Tooltip content={tooltip} side="top">
      <button
        onClick={onClick}
        className={cn(
          'mesh-pressable h-10 w-10 rounded-full flex items-center justify-center transition-colors',
          streaming
            ? 'mesh-live-badge bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30'
            : danger
              ? active
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-red-500 hover:bg-red-600 text-white'
              : active
                ? 'bg-mesh-bg-tertiary text-mesh-text-secondary hover:bg-mesh-bg-elevated hover:text-mesh-text-primary'
                : 'bg-mesh-bg-tertiary text-mesh-text-secondary hover:bg-mesh-bg-elevated hover:text-mesh-text-primary'
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export { VoiceControlBar }
