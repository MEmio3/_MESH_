import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, Copy, Check } from 'lucide-react'

interface KeyGenerationStepProps {
  username: string
  avatarColor: string | null
  onNext: (keypair: { userId: string; publicKey: string }) => void
}

function KeyGenerationStep({ username, avatarColor, onNext }: KeyGenerationStepProps): JSX.Element {
  const [phase, setPhase] = useState<'generating' | 'done'>('generating')
  const [keypair, setKeypair] = useState<{ userId: string; publicKey: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function generate(): Promise<void> {
      try {
        // Run real keygen with timeout + minimum animation delay in parallel
        const [result] = await Promise.all([
          Promise.race([
            window.api.identityGenerate({ username, avatarColor }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Identity generation timed out after 10 seconds')), 10000)
            )
          ]),
          new Promise((r) => setTimeout(r, 800))
        ])

        if (!cancelled) {
          setKeypair(result)
          setPhase('done')
        }
      } catch (err) {
        console.error('KeyGenerationStep: identity generation failed:', err)
        if (!cancelled) {
          // Still show done phase but with null keypair to unblock UI
          setPhase('done')
        }
      }
    }

    generate()
    return () => { cancelled = true }
  }, [username, avatarColor])

  const handleCopy = (): void => {
    if (keypair) {
      navigator.clipboard.writeText(keypair.userId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="w-full max-w-md text-center">
        <AnimatePresence mode="wait">
          {phase === 'generating' ? (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center"
            >
              {/* Animated shield */}
              <div className="relative mb-8">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-0 rounded-full border-2 border-transparent border-t-mesh-green h-28 w-28 -m-2"
                />
                <div className="h-24 w-24 rounded-full bg-mesh-bg-tertiary flex items-center justify-center">
                  <Shield className="h-10 w-10 text-mesh-green" />
                </div>
              </div>

              <h2 className="text-xl font-bold text-mesh-text-primary mb-2">
                Generating your identity
              </h2>
              <p className="text-sm text-mesh-text-muted">
                Creating Ed25519 keypair for {username}...
              </p>

              {/* Progress dots */}
              <div className="flex gap-1.5 mt-6">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    className="h-2 w-2 rounded-full bg-mesh-green"
                  />
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center"
            >
              {/* Success icon */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="h-20 w-20 rounded-full bg-mesh-green/20 flex items-center justify-center mb-6"
              >
                <Shield className="h-10 w-10 text-mesh-green" />
              </motion.div>

              <h2 className="text-xl font-bold text-mesh-text-primary mb-2">
                Identity created
              </h2>
              <p className="text-sm text-mesh-text-muted mb-6">
                Your permanent User ID is ready. This cannot be changed or recovered if lost.
              </p>

              {/* User ID display */}
              <div className="w-full bg-mesh-bg-tertiary rounded-lg border border-mesh-border p-4 mb-3">
                <label className="block text-[10px] font-semibold text-mesh-text-muted uppercase tracking-wider mb-2 text-left">
                  Your User ID
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm text-mesh-green font-mono truncate text-left">
                    {keypair?.userId}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="shrink-0 h-8 w-8 rounded-md flex items-center justify-center text-mesh-text-muted hover:text-mesh-text-primary hover:bg-mesh-bg-hover transition-colors"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-mesh-green" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Public key (collapsed) */}
              <div className="w-full bg-mesh-bg-tertiary/50 rounded-lg border border-mesh-border/50 p-3 mb-8">
                <label className="block text-[10px] font-semibold text-mesh-text-muted uppercase tracking-wider mb-1 text-left">
                  Public Key
                </label>
                <p className="text-[11px] text-mesh-text-muted font-mono truncate text-left">
                  {keypair?.publicKey}
                </p>
              </div>

              {/* Continue */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => keypair && onNext(keypair)}
                className="w-full py-3 rounded-lg bg-mesh-green hover:bg-mesh-green-light text-white font-semibold transition-colors"
              >
                Continue
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export { KeyGenerationStep }
