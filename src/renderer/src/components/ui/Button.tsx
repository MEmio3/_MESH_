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
          'mesh-control-button mesh-pressable inline-flex items-center justify-center font-medium transition-colors duration-150 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mesh-green/60 focus-visible:ring-offset-1 focus-visible:ring-offset-mesh-bg-primary disabled:opacity-50 disabled:pointer-events-none',
          {
            // Glossy accent: vertical gradient + inner top highlight + press-down.
            'text-white border border-white/10 bg-gradient-to-b from-mesh-green-light to-mesh-green hover:from-mesh-green hover:to-mesh-green-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_3px_rgba(0,0,0,0.4)] active:translate-y-px active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]': variant === 'primary',
            // Surface + hairline border with a whisper of top light.
            'bg-mesh-bg-tertiary hover:bg-mesh-bg-hover text-mesh-text-primary border border-mesh-border shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] active:translate-y-px': variant === 'secondary',
            'text-white border border-white/10 bg-gradient-to-b from-mesh-danger-hover to-mesh-danger hover:to-mesh-danger shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_3px_rgba(0,0,0,0.4)] active:translate-y-px': variant === 'danger',
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
