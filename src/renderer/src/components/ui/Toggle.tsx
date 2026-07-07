import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

function Toggle({ checked, onChange, disabled, className }: ToggleProps): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mesh-green/60 disabled:opacity-50 disabled:cursor-not-allowed',
        'mesh-pressable',
        checked
          ? 'bg-mesh-green border-mesh-green shadow-[inset_0_1px_2px_rgba(0,0,0,0.2),0_0_10px_-2px_var(--color-mesh-green)]'
          : 'bg-mesh-bg-elevated border-mesh-border-light shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]',
        className
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        animate={{ scale: checked ? 1 : 0.92 }}
        className={cn(
          'pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-mesh-text-primary shadow-sm mt-[2px]',
          checked ? 'ml-[18px]' : 'ml-[2px]'
        )}
      />
    </button>
  )
}

export { Toggle }
