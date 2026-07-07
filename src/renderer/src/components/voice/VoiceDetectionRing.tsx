import { cn } from '@/lib/utils'

type VoiceDetectionRingSize = 'xs' | 'sm' | 'lg'

interface VoiceDetectionRingProps {
  size?: VoiceDetectionRingSize
  bars?: boolean
  className?: string
}

const barDelays = ['0ms', '110ms', '220ms']

function VoiceDetectionRing({ size = 'sm', bars = true, className }: VoiceDetectionRingProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('voice-detection-ring', `voice-detection-ring-${size}`, className)}
    >
      {bars && (
        <span className="voice-level-bars">
          {barDelays.map((delay) => (
            <span key={delay} style={{ animationDelay: delay }} />
          ))}
        </span>
      )}
    </span>
  )
}

export { VoiceDetectionRing }
