import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          className={cn(
            'mesh-input-field w-full h-9 px-3 rounded-md bg-mesh-bg-secondary border text-mesh-text-primary text-sm',
            'shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]',
            'placeholder:text-mesh-text-muted',
            // Hairline focus: accent border + faint halo, not a thick ring.
            'focus:outline-none focus:border-mesh-green focus:ring-1 focus:ring-mesh-green/30',
            'transition-[background-color,border-color,box-shadow] duration-150',
            error ? 'border-mesh-danger' : 'border-mesh-border',
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-mesh-danger">{error}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
export { Input, type InputProps }
