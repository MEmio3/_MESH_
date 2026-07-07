import { cn } from '@/lib/utils'
import type { ReactionMap } from '@/types/messages'
import data from '@emoji-mart/data'

interface ReactionBarProps {
  reactions: ReactionMap
  selfId: string
  onToggle: (emojiId: string) => void
}

function getNativeEmoji(id: string): string {
  if (!data || !('emojis' in data)) return id
  const emojis = (data as any).emojis
  const record = emojis[id]
  if (record && record.skins && record.skins.length > 0 && record.skins[0].native) {
    return record.skins[0].native
  }
  return id
}

export function ReactionBar({ reactions, selfId, onToggle }: ReactionBarProps): JSX.Element | null {
  const entries = Object.entries(reactions).filter(([, userIds]) => userIds.length > 0)
  if (entries.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {entries.map(([emojiId, userIds]) => {
        const hasReacted = userIds.includes(selfId)
        const nativeEmoji = getNativeEmoji(emojiId)
        
        return (
          <button
            key={emojiId}
            onClick={() => onToggle(emojiId)}
            className={cn(
              "mesh-reaction-chip mesh-pressable flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-xs font-medium transition-colors border",
              hasReacted 
                ? "bg-mesh-green/20 border-mesh-green/50 text-mesh-green" 
                : "bg-mesh-bg-tertiary border-transparent text-mesh-text-secondary hover:bg-mesh-bg-elevated hover:border-mesh-border"
            )}
            title={emojiId}
          >
            <span className="text-base leading-none">{nativeEmoji}</span>
            <span>{userIds.length}</span>
          </button>
        )
      })}
    </div>
  )
}
