import { useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProfileSetupStepProps {
  onNext: (data: { username: string; avatarIndex: number }) => void
  onBack: () => void
}

const defaultAvatars = [
  { bg: '#107C10', label: 'Green' },
  { bg: '#0078d4', label: 'Blue' },
  { bg: '#8764B8', label: 'Purple' },
  { bg: '#d13438', label: 'Red' },
  { bg: '#ffb900', label: 'Gold' },
  { bg: '#00B7C3', label: 'Teal' },
  { bg: '#E74856', label: 'Pink' },
  { bg: '#767676', label: 'Gray' },
]

function ProfileSetupStep({ onNext, onBack }: ProfileSetupStepProps): JSX.Element {
  const [username, setUsername] = useState('')
  const [selectedAvatar, setSelectedAvatar] = useState(0)
  const [error, setError] = useState('')

  const validate = (): boolean => {
    const trimmed = username.trim()
    if (trimmed.length < 2) {
      setError('Username must be at least 2 characters')
      return false
    }
    if (trimmed.length > 24) {
      setError('Username must be 24 characters or less')
      return false
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setError('Only letters, numbers, and underscores allowed')
      return false
    }
    setError('')
    return true
  }

  const handleContinue = (): void => {
    if (validate()) {
      onNext({ username: username.trim(), avatarIndex: selectedAvatar })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') handleContinue()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3 }}
      className="flex h-full flex-col items-center justify-center px-8"
    >
      <div className="w-full max-w-md rounded-3xl border border-mesh-border/70 bg-mesh-bg-secondary/82 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.04)]">
        {/* Back button */}
        <button
          onClick={onBack}
          className="mb-6 flex items-center gap-1.5 rounded-lg px-1 text-sm text-mesh-text-muted transition-colors hover:text-mesh-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <h2 className="mb-1 text-2xl font-bold text-mesh-text-primary">
          Create your profile
        </h2>
        <p className="mb-8 text-sm text-mesh-text-muted">
          This is how others will see you on MESH.
        </p>

        {/* Avatar Selection */}
        <div className="mb-8">
          <label className="block text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-3">
            Choose an Avatar
          </label>
          <div className="grid grid-cols-4 gap-3">
            {defaultAvatars.map((avatar, i) => {
              const initial = username.trim() ? username.trim()[0].toUpperCase() : '?'
              return (
                <button
                  key={i}
                  onClick={() => setSelectedAvatar(i)}
                  className={cn(
                    'h-12 w-12 rounded-2xl flex items-center justify-center text-white font-bold text-lg transition-all duration-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]',
                    selectedAvatar === i
                      ? 'ring-2 ring-mesh-green ring-offset-2 ring-offset-mesh-bg-secondary scale-105'
                      : 'hover:scale-105 opacity-75 hover:opacity-100'
                  )}
                  style={{ backgroundColor: avatar.bg }}
                >
                  {initial}
                </button>
              )
            })}
          </div>
        </div>

        {/* Username Input */}
        <div className="mb-8">
          <label className="block text-xs font-semibold text-mesh-text-secondary uppercase tracking-wide mb-2">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              if (error) setError('')
            }}
            onKeyDown={handleKeyDown}
            placeholder="Enter a username"
            maxLength={24}
            autoFocus
            className={cn(
              'w-full h-11 px-4 rounded-xl bg-mesh-bg-tertiary/75 text-mesh-text-primary text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-mesh-green/50',
              'placeholder:text-mesh-text-muted',
              error ? 'border-mesh-danger' : 'border-mesh-border'
            )}
          />
          {error && (
            <p className="mt-1.5 text-xs text-mesh-danger">{error}</p>
          )}
          <p className="mt-1.5 text-xs text-mesh-text-muted">
            {username.length}/24 — Letters, numbers, and underscores only
          </p>
        </div>

        {/* Continue */}
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={handleContinue}
          disabled={username.trim().length < 2}
          className="w-full rounded-xl bg-mesh-green py-3 font-semibold text-white shadow-[0_18px_40px_rgba(35,165,89,0.24)] transition-colors hover:bg-mesh-green-light disabled:opacity-40 disabled:hover:bg-mesh-green"
        >
          Continue
        </motion.button>
      </div>
    </motion.div>
  )
}

export { ProfileSetupStep }
