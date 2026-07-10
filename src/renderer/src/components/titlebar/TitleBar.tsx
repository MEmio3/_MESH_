import { useState, useEffect } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { cn } from '@/lib/utils'

function TitleBar(): JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api.isMaximized().then(setIsMaximized)
    const unsubscribe = window.api.onMaximizedChange(setIsMaximized)
    return unsubscribe
  }, [])

  return (
    <div className="mesh-titlebar app-drag relative flex h-8 select-none items-center bg-mesh-bg-primary">
      {/* Center aligned title */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center pointer-events-none">
        <span className="mesh-title-mark text-xs font-medium uppercase text-mesh-text-muted">
          MESH
        </span>
      </div>

      {/* Window Controls */}
      <div className="flex items-center h-full app-no-drag ml-auto">
        <TitleBarButton onClick={() => window.api.minimize()} aria-label="Minimize">
          <Minus className="h-3.5 w-3.5" />
        </TitleBarButton>
        <TitleBarButton onClick={() => window.api.maximize()} aria-label="Maximize">
          {isMaximized ? (
            <Copy className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </TitleBarButton>
        <TitleBarButton
          onClick={() => window.api.close()}
          aria-label="Close"
          variant="close"
        >
          <X className="h-4 w-4" />
        </TitleBarButton>
      </div>
    </div>
  )
}

function TitleBarButton({
  children,
  variant = 'default',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'close' }): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'mesh-titlebar-button inline-flex h-8 w-11 items-center justify-center transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-mesh-green/60',
        variant === 'close'
          ? 'hover:bg-red-500 text-mesh-text-secondary hover:text-white'
          : 'hover:bg-mesh-bg-tertiary text-mesh-text-secondary hover:text-mesh-text-primary',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export { TitleBar }
