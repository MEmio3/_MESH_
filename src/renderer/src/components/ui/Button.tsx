import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg' | 'icon'
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-colors duration-150 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mesh-green/60 focus-visible:ring-offset-1 focus-visible:ring-offset-mesh-bg-primary disabled:opacity-50 disabled:pointer-events-none',
          {
            // Filled accent with a tonal border edge — reads intentional, not loud.
            'bg-mesh-green hover:bg-mesh-green-light text-white border border-white/10': variant === 'primary',
            // Surface + hairline border, the workhorse of a pro tool.
            'bg-mesh-bg-tertiary hover:bg-mesh-bg-hover text-mesh-text-primary border border-mesh-border': variant === 'secondary',
            'bg-mesh-danger/90 hover:bg-mesh-danger text-white border border-white/10': variant === 'danger',
            'bg-transparent hover:bg-mesh-bg-tertiary text-mesh-text-secondary hover:text-mesh-text-primary': variant === 'ghost',
          },
          {
            'h-7 px-2.5 text-xs': size === 'sm',
            'h-8 px-3.5 text-sm': size === 'md',
            'h-10 px-5 text-sm': size === 'lg',
            'h-8 w-8 p-0': size === 'icon',
          },
          className
        )}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'
export { Button, type ButtonProps }
