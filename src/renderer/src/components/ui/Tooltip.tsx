import { useState, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
  className?: string
}

function Tooltip({ content, side = 'right', children, className }: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (): void => {
    timeoutRef.current = setTimeout(() => setVisible(true), 300)
  }

  const hide = (): void => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  return (
    <div
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && (
        <div
          className={cn(
            'absolute z-[250] whitespace-nowrap rounded-md bg-mesh-bg-elevated/95 backdrop-blur-sm border border-mesh-border-light/60 px-2.5 py-1.5 text-xs font-medium text-mesh-text-primary shadow-[0_8px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] pointer-events-none animate-in fade-in-0 zoom-in-95 duration-100',
            positionClasses[side]
          )}
        >
          {content}
        </div>
      )}
    </div>
  )
}

export { Tooltip, type TooltipProps }
