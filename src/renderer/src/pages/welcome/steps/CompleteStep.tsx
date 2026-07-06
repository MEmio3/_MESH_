import { motion } from 'framer-motion'
import { Check } from 'lucide-react'

interface CompleteStepProps {
  username: string
  onEnter: () => void
}

function CompleteStep({ username, onEnter }: CompleteStepProps): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="w-full max-w-md rounded-3xl border border-mesh-border/70 bg-mesh-bg-secondary/82 p-8 shadow-[0_28px_80px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.04)]">
      {/* Animated checkmark */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 250, damping: 20, delay: 0.1 }}
        className="relative mb-8"
      >
        {/* Glow ring */}
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="absolute inset-0 blur-[40px] rounded-full bg-mesh-green/30 scale-150"
        />

        {/* Circle with check */}
        <div className="relative h-24 w-24 rounded-full bg-mesh-green flex items-center justify-center shadow-lg shadow-mesh-green/30">
          <motion.div
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
          >
            <Check className="h-12 w-12 text-white" strokeWidth={3} />
          </motion.div>
        </div>
      </motion.div>

      {/* Text */}
      <motion.h2
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="mb-2 text-2xl font-bold text-mesh-text-primary"
      >
        You're all set, {username}!
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="mx-auto mb-10 max-w-sm text-sm text-mesh-text-muted"
      >
        Your decentralized identity is ready. Connect to a relay, find friends,
        and start communicating — privately and securely.
      </motion.p>

      {/* Enter button */}
      <motion.button
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.4 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onEnter}
        className="rounded-xl bg-mesh-green px-10 py-3.5 text-base font-semibold text-white shadow-[0_18px_40px_rgba(35,165,89,0.24)] transition-colors hover:bg-mesh-green-light"
      >
        Enter MESH
      </motion.button>
      </div>
    </div>
  )
}

export { CompleteStep }
