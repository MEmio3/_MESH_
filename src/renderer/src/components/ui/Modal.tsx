import { useEffect, type ReactNode } from 'react'
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
            variants={modalMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={meshSoftSpring}
            className={cn(
              'mesh-reveal-in relative w-full max-w-md mx-4 rounded-xl bg-mesh-bg-secondary border border-mesh-border-light/60 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.05)]',
              className
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <h2 className="text-lg font-bold text-mesh-text-primary">{title}</h2>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-tertiary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className={cn('px-5 pb-5', bodyClassName)}>
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
