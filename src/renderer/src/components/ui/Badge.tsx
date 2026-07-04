import { cn } from '@/lib/utils'

interface BadgeProps {
  count: number
  className?: string
}

function Badge({ count, className }: BadgeProps): JSX.Element | null {
  if (count <= 0) return null

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-mesh-danger text-white text-[10px] font-semibold leading-none tabular-nums',
        className
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

export { Badge, type BadgeProps }
