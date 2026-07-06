import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useIdentityStore } from '@/stores/identity.store'
import { initializeAllStores } from '@/stores/init'
import { WelcomeStep } from './steps/WelcomeStep'
import { ProfileSetupStep } from './steps/ProfileSetupStep'
import { KeyGenerationStep } from './steps/KeyGenerationStep'
import { CompleteStep } from './steps/CompleteStep'

type Step = 'welcome' | 'profile' | 'keygen' | 'complete'

// Avatar colors matching ProfileSetupStep
const avatarColors = ['#107C10', '#0078d4', '#8764B8', '#d13438', '#ffb900', '#00B7C3', '#E74856', '#767676']

function WelcomePage(): JSX.Element {
  const navigate = useNavigate()
  const setIdentity = useIdentityStore((s) => s.setIdentity)

  const [step, setStep] = useState<Step>('welcome')
  const [profileData, setProfileData] = useState<{ username: string; avatarIndex: number } | null>(null)

  const handleProfileDone = (data: { username: string; avatarIndex: number }): void => {
    setProfileData(data)
    setStep('keygen')
  }

  const handleKeygenDone = (keypair: { userId: string; publicKey: string }): void => {
    if (profileData) {
      setIdentity({
        userId: keypair.userId,
        publicKey: keypair.publicKey,
        username: profileData.username,
        avatarPath: avatarColors[profileData.avatarIndex] || null,
        createdAt: Date.now(),
      })
    }
    setStep('complete')
  }

  const handleEnter = async (): Promise<void> => {
    // Initialize all stores from DB now that identity exists
    await initializeAllStores()
    navigate('/channels/@me')
  }

  const stepIndex = ['welcome', 'profile', 'keygen', 'complete'].indexOf(step) + 1

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-mesh-bg-primary">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(35,165,89,0.16),transparent_28%),radial-gradient(circle_at_82%_8%,rgba(0,120,212,0.12),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_44%)]" />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-mesh-text-muted) 1px, transparent 1px), linear-gradient(90deg, var(--color-mesh-text-muted) 1px, transparent 1px)',
          backgroundSize: '42px 42px',
        }}
      />
      <div className="absolute left-6 top-6 z-10 flex items-center gap-2">
        {[1, 2, 3, 4].map((item) => (
          <span
            key={item}
            className={`h-1.5 rounded-full transition-all ${item <= stepIndex ? 'w-8 bg-mesh-green' : 'w-4 bg-mesh-bg-tertiary'}`}
          />
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="relative h-full"
        >
          {step === 'welcome' && (
            <WelcomeStep onNext={() => setStep('profile')} />
          )}
          {step === 'profile' && (
            <ProfileSetupStep
              onNext={handleProfileDone}
              onBack={() => setStep('welcome')}
            />
          )}
          {step === 'keygen' && profileData && (
            <KeyGenerationStep
              username={profileData.username}
              avatarColor={avatarColors[profileData.avatarIndex] || null}
              onNext={handleKeygenDone}
            />
          )}
          {step === 'complete' && profileData && (
            <CompleteStep
              username={profileData.username}
              onEnter={handleEnter}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export { WelcomePage }
