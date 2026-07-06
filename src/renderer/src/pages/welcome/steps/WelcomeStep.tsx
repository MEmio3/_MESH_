import { motion } from 'framer-motion'
import { ArrowRight, Shield, Wifi } from 'lucide-react'

interface WelcomeStepProps {
  onNext: () => void
}

function WelcomeStep({ onNext }: WelcomeStepProps): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-mesh-border/70 bg-mesh-bg-secondary/82 p-8 shadow-[0_28px_80px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="absolute inset-x-12 -top-24 h-44 rounded-full bg-mesh-green/16 blur-3xl" />

        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="relative mx-auto mb-7 grid h-24 w-24 place-items-center rounded-3xl border border-mesh-green/25 bg-mesh-green text-white shadow-[0_22px_54px_rgba(35,165,89,0.28)]"
        >
          <span className="text-4xl font-black tracking-tight">M</span>
        </motion.div>

        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="relative mb-3 text-4xl font-bold tracking-tight text-mesh-text-primary"
        >
          Welcome to MESH
        </motion.h1>

        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="relative mb-6 text-lg text-mesh-text-secondary"
        >
          Decentralized. Private. Yours.
        </motion.p>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.45, duration: 0.5 }}
          className="relative mb-8 grid gap-2 sm:grid-cols-2"
        >
          <WelcomePill icon={<Shield className="h-4 w-4" />} label="Local identity" />
          <WelcomePill icon={<Wifi className="h-4 w-4" />} label="Peer-first network" />
        </motion.div>

        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onNext}
          className="relative inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-mesh-green px-8 text-base font-semibold text-white shadow-[0_18px_40px_rgba(35,165,89,0.28)] transition-colors hover:bg-mesh-green-light"
        >
          Get Started
          <ArrowRight className="h-4 w-4" />
        </motion.button>
      </div>
    </div>
  )
}

function WelcomePill({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-mesh-border/60 bg-mesh-bg-tertiary/55 px-3 py-2 text-sm font-medium text-mesh-text-secondary">
      <span className="text-mesh-green">{icon}</span>
      {label}
    </div>
  )
}

export { WelcomeStep }
