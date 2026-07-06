import { useEffect, useState } from 'react'
import { Calendar, Camera, Check, Copy, Fingerprint, KeyRound, UserRound } from 'lucide-react'
import { useIdentityStore } from '@/stores/identity.store'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useAvatarStore } from '@/stores/avatar.store'

function ProfileSettings(): JSX.Element {
  const identity = useIdentityStore((s) => s.identity)
  const selfAvatar = useAvatarStore((s) => s.self)
  const uploadSelf = useAvatarStore((s) => s.uploadSelf)
  const [copied, setCopied] = useState<'id' | 'key' | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState(identity?.username || '')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    useAvatarStore.getState().initialize()
  }, [])

  const handleAvatarClick = async (): Promise<void> => {
    if (uploading) return
    setUploading(true)
    setUploadError(null)
    const res = await uploadSelf()
    if (!res.success && res.error) setUploadError(res.error)
    setUploading(false)
  }

  const handleCopy = (text: string, type: 'id' | 'key'): void => {
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-mesh-text-primary">My Profile</h2>
        <p className="mt-1 text-sm text-mesh-text-muted">Manage how your identity appears across MESH.</p>
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border border-mesh-border/70 bg-mesh-bg-secondary shadow-[0_18px_48px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="h-28 bg-[radial-gradient(circle_at_20%_20%,rgba(35,165,89,0.45),transparent_28%),radial-gradient(circle_at_78%_4%,rgba(0,120,212,0.32),transparent_30%),linear-gradient(135deg,rgba(35,165,89,0.18),rgba(255,255,255,0.02))]" />
        <div className="px-5 pb-5">
          <div className="-mt-10 flex items-end gap-4">
            <button
              onClick={handleAvatarClick}
              disabled={uploading}
              className="group relative shrink-0 rounded-full bg-mesh-bg-secondary p-1.5 shadow-[0_16px_36px_rgba(0,0,0,0.34)] focus:outline-none focus:ring-2 focus:ring-mesh-green disabled:opacity-60"
              title="Upload profile picture (JPG/PNG, max 2MB)"
            >
              <Avatar
                src={selfAvatar}
                fallback={identity?.username || 'U'}
                size="xl"
                status="online"
              />
              <span className="absolute inset-1.5 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="h-5 w-5 text-white" />
              </span>
            </button>

            <div className="min-w-0 flex-1 pb-1">
              {editingName ? (
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                    maxLength={24}
                    className="h-9 min-w-[180px] rounded-lg border border-mesh-border bg-mesh-bg-tertiary px-3 text-sm text-mesh-text-primary outline-none transition focus:border-mesh-green focus:ring-1 focus:ring-mesh-green/30"
                  />
                  <Button size="sm" onClick={() => setEditingName(false)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingName(false); setNewName(identity?.username || '') }}>Cancel</Button>
                </div>
              ) : (
                <div className="mb-1 flex min-w-0 items-center gap-2">
                  <span className="truncate text-2xl font-bold text-mesh-text-primary">
                    {identity?.username || 'MeshUser'}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setEditingName(true)}>Edit</Button>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-mesh-text-secondary">
                <span className="h-2 w-2 rounded-full bg-mesh-green shadow-[0_0_12px_rgba(35,165,89,0.65)]" />
                Online
              </div>
              {uploadError && (
                <p className="mt-1 text-[11px] text-red-400">{uploadError}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <IdentityField
          icon={<Fingerprint className="h-4 w-4" />}
          label="User ID"
          value={identity?.userId || 'usr_not_generated'}
          copied={copied === 'id'}
          onCopy={() => handleCopy(identity?.userId || '', 'id')}
          accent
        />

        <IdentityField
          icon={<KeyRound className="h-4 w-4" />}
          label="Public Key"
          value={identity?.publicKey || 'not generated'}
          copied={copied === 'key'}
          onCopy={() => handleCopy(identity?.publicKey || '', 'key')}
        />

        <div className="rounded-xl border border-mesh-border/70 bg-mesh-bg-secondary p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="mb-2 flex items-center gap-2 text-mesh-text-muted">
            <Calendar className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Account Created</span>
          </div>
          <span className="text-sm text-mesh-text-secondary">
            {identity?.createdAt
              ? new Date(identity.createdAt).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
              : 'Unknown'}
          </span>
        </div>
      </div>
    </div>
  )
}

function IdentityField({
  icon,
  label,
  value,
  copied,
  onCopy,
  accent = false
}: {
  icon: JSX.Element
  label: string
  value: string
  copied: boolean
  onCopy: () => void
  accent?: boolean
}): JSX.Element {
  return (
    <div className="rounded-xl border border-mesh-border/70 bg-mesh-bg-secondary p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="mb-2 flex items-center gap-2 text-mesh-text-muted">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-mesh-border/60 bg-mesh-bg-tertiary/55 px-3 py-2.5">
        {accent && <UserRound className="h-4 w-4 shrink-0 text-mesh-green" />}
        <code className={`min-w-0 flex-1 truncate font-mono ${accent ? 'text-sm text-mesh-green' : 'text-[11px] text-mesh-text-muted'}`}>
          {value}
        </code>
        <button
          onClick={onCopy}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mesh-text-muted transition-colors hover:bg-mesh-bg-hover hover:text-mesh-text-primary"
        >
          {copied ? <Check className="h-4 w-4 text-mesh-green" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

export { ProfileSettings }
