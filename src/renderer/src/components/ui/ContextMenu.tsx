import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface ContextMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
  separator?: false
}

interface ContextMenuSeparator {
  separator: true
}

type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

interface ContextMenuProps {
  items: ContextMenuEntry[]
  children: ReactNode
  className?: string
}

function ContextMenu({ items, children, className }: ContextMenuProps): JSX.Element {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setPosition(null), [])

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    // Ensure menu doesn't go off-screen
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 200))
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - items.length * 36 - 16))
    setPosition({ x, y })
  }

  useEffect(() => {
    if (!position) return

    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close()
      }
    }

    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [position, close])

  return (
    <>
      <div onContextMenu={handleContextMenu} className={className}>
        {children}
      </div>

      {position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="mesh-floating-surface fixed z-[100] min-w-[180px] rounded-lg border border-mesh-border/60 bg-mesh-bg-elevated/98 py-1.5 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ left: position.x, top: position.y }}
          >
            {items.map((item, i) => {
              if (item.separator) {
                return <div key={i} role="separator" className="mx-2 my-1 h-px bg-mesh-border/60" />
              }
              return (
                <button
                  type="button"
                  role="menuitem"
                  key={i}
                  onClick={() => {
                    item.onClick()
                    close()
                  }}
                  className={cn(
                    'mesh-context-menu-item mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-mesh-green/55',
                    item.variant === 'danger'
                      ? 'text-red-400 hover:bg-red-500 hover:text-white'
                      : 'text-mesh-text-secondary hover:bg-mesh-green hover:text-white'
                  )}
                >
                  {item.icon && <span className="h-4 w-4 shrink-0">{item.icon}</span>}
                  {item.label}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}

export { ContextMenu, type ContextMenuEntry }
