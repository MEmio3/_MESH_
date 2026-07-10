import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { meshEase, meshSoftSpring, modalMotion } from '@/lib/motion'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  bodyClassName?: string
}

function Modal({ isOpen, onClose, title, children, className, bodyClassName }: ModalProps): JSX.Element | null {
  const titleId = useId()

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={meshEase}
            className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
            onClick={onClose}
          />

          {/* Content */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            variants={modalMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={meshSoftSpring}
            className={cn(
              'mesh-modal-surface mesh-reveal-in relative mx-4 w-full max-w-md overflow-hidden rounded-lg border border-mesh-border-light/60 bg-mesh-bg-secondary',
              className
            )}
          >
            {/* Header */}
            <div className="mesh-modal-header flex items-center justify-between border-b border-mesh-border/60 px-5 py-3.5">
              <h2 id={titleId} className="text-base font-bold text-mesh-text-primary">{title}</h2>
              <button
                type="button"
                aria-label={`Close ${title}`}
                onClick={onClose}
                className="mesh-icon-button mesh-pressable flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-mesh-text-muted transition-colors hover:border-mesh-border/70 hover:bg-mesh-bg-tertiary hover:text-mesh-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mesh-green/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className={cn('px-5 py-4', bodyClassName)}>
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export { Modal }
