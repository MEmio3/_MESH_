import type { Transition, Variants } from 'framer-motion'

export const meshSpring: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 34,
  mass: 0.78
}

export const meshSoftSpring: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 32,
  mass: 0.9
}

export const meshEase: Transition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1]
}

export const pageMotion: Variants = {
  initial: { opacity: 0, y: 8, filter: 'blur(2px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -4, filter: 'blur(1px)' }
}

export const modalMotion: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 14, filter: 'blur(2px)' },
  animate: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.97, y: 10, filter: 'blur(1px)' }
}

export const popoverMotion: Variants = {
  initial: { opacity: 0, scale: 0.96, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: -2 }
}

export const tapMotion = {
  whileTap: { scale: 0.97 }
} as const
