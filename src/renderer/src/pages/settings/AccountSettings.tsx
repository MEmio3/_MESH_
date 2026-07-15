import { useState } from 'react'
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Eye,
  EyeOff,
  FileKey2,
  FolderOpen,
  HardDriveDownload,
  History,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserRoundPlus
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface RecoveryManifest {
  formatVersion: number
  appVersion: string
  exportedAt: number
  includeHistory: boolean
  identity: {
    userId: string
    username: string
    publicKey: string
    createdAt: number
  }
  counts: {
    friends: number
    servers: number
    conversations: number
    directMessages: number
    serverMessages: number
    settings: number
  }
  files: number
  fileBytes: number
}

type Notice = { tone: 'success' | 'error'; text: string } | null

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'The operation could not be completed.'
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AccountSettings(): JSX.Element {
  const [exportPassword, setExportPassword] = useState('')
  const [exportConfirmation, setExportConfirmation] = useState('')
  const [includeHistory, setIncludeHistory] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState<Notice>(null)

  const [selectedBundle, setSelectedBundle] = useState<{ path: string; fileName: string; sizeBytes: number } | null>(null)
  const [restorePassword, setRestorePassword] = useState('')
  const [preview, setPreview] = useState<RecoveryManifest | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreNotice, setRestoreNotice] = useState<Notice>(null)

  const [freshOpen, setFreshOpen] = useState(false)
  const [freshConfirmation, setFreshConfirmation] = useState('')
  const [freshBusy, setFreshBusy] = useState(false)
  const [restartResult, setRestartResult] = useState<{ title: string; archiveName: string } | null>(null)

  const handleExport = async (): Promise<void> => {
    setExportNotice(null)
    if (exportPassword.length < 10) {
      setExportNotice({ tone: 'error', text: 'Use a recovery password with at least 10 characters.' })
      return
    }
    if (exportPassword !== exportConfirmation) {
      setExportNotice({ tone: 'error', text: 'The recovery passwords do not match.' })
      return
    }
    setExporting(true)
    try {
      const result = await window.api.recovery.export({ password: exportPassword, includeHistory })
      if (!result.canceled) {
        setExportPassword('')
        setExportConfirmation('')
        setExportNotice({ tone: 'success', text: 'Encrypted recovery bundle exported.' })
      }
    } catch (error) {
      setExportNotice({ tone: 'error', text: errorMessage(error) })
    } finally {
      setExporting(false)
    }
  }

  const handleSelect = async (): Promise<void> => {
    setRestoreNotice(null)
    try {
      const result = await window.api.recovery.select()
      if (!result.canceled && result.path && result.fileName) {
        setSelectedBundle({ path: result.path, fileName: result.fileName, sizeBytes: result.sizeBytes || 0 })
        setRestorePassword('')
        setPreview(null)
      }
    } catch (error) {
      setRestoreNotice({ tone: 'error', text: errorMessage(error) })
    }
  }

  const handleInspect = async (): Promise<void> => {
    if (!selectedBundle) return
    setRestoreBusy(true)
    setRestoreNotice(null)
    try {
      const manifest = await window.api.recovery.inspect({ path: selectedBundle.path, password: restorePassword })
      setPreview(manifest)
    } catch (error) {
      setPreview(null)
      setRestoreNotice({ tone: 'error', text: errorMessage(error) })
    } finally {
      setRestoreBusy(false)
    }
  }

  const handleRestore = async (): Promise<void> => {
    if (!selectedBundle || !preview) return
    setRestoreBusy(true)
    setRestoreNotice(null)
    try {
      const result = await window.api.recovery.restore({ path: selectedBundle.path, password: restorePassword })
      setRestartResult({ title: `${result.manifest.identity.username} is ready`, archiveName: result.archiveName })
    } catch (error) {
      setRestoreNotice({ tone: 'error', text: errorMessage(error) })
    } finally {
      setRestoreBusy(false)
    }
  }

  const handleFreshIdentity = async (): Promise<void> => {
    setFreshBusy(true)
    try {
      const result = await window.api.recovery.createFresh(freshConfirmation)
      setFreshOpen(false)
      setRestartResult({ title: 'Fresh identity setup is ready', archiveName: result.archiveName })
    } catch (error) {
      setRestoreNotice({ tone: 'error', text: errorMessage(error) })
    } finally {
      setFreshBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-mesh-text-primary">Account</h2>
          <p className="mt-1 text-sm text-mesh-text-muted">Secure your identity and move it between devices.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-mesh-green/25 bg-mesh-green/8 px-2.5 py-1.5 text-xs font-medium text-mesh-green">
          <ShieldCheck className="h-3.5 w-3.5" />
          Local-first recovery
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <SectionHeading
            icon={<HardDriveDownload className="h-4 w-4" />}
            title="Export recovery bundle"
            detail="Password-encrypted identity backup"
          />

          <label className="mb-4 flex cursor-pointer items-start justify-between gap-4 rounded-md border border-mesh-border/60 bg-mesh-bg-tertiary/40 p-3">
            <span className="flex min-w-0 gap-2.5">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-mesh-text-secondary" />
              <span>
                <span className="block text-sm font-medium text-mesh-text-primary">Include chat history</span>
                <span className="mt-0.5 block text-xs leading-5 text-mesh-text-muted">Adds messages and managed downloads.</span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(event) => setIncludeHistory(event.target.checked)}
              className="mt-1 h-4 w-4 accent-mesh-green"
            />
          </label>

          <div className="space-y-3">
            <PasswordField label="Recovery password" value={exportPassword} onChange={setExportPassword} />
            <PasswordField label="Confirm password" value={exportConfirmation} onChange={setExportConfirmation} />
          </div>

          <NoticeLine notice={exportNotice} />
          <Button className="mt-4 w-full gap-2" onClick={handleExport} disabled={exporting}>
            {exporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileKey2 className="h-4 w-4" />}
            {exporting ? 'Encrypting bundle' : 'Export encrypted bundle'}
          </Button>
        </section>

        <section className="rounded-lg border border-mesh-border/70 bg-mesh-bg-secondary p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <SectionHeading
            icon={<ArchiveRestore className="h-4 w-4" />}
            title="Restore identity"
            detail="Inspect before replacing this profile"
          />

          <button
            type="button"
            onClick={handleSelect}
            className="mb-3 flex min-h-16 w-full items-center gap-3 rounded-md border border-dashed border-mesh-border bg-mesh-bg-tertiary/35 px-3 text-left transition-colors hover:border-mesh-green/50 hover:bg-mesh-bg-tertiary/60"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-mesh-bg-tertiary text-mesh-text-secondary">
              <FolderOpen className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-mesh-text-primary">
                {selectedBundle?.fileName || 'Choose recovery bundle'}
              </span>
              <span className="mt-0.5 block text-xs text-mesh-text-muted">
                {selectedBundle ? formatBytes(selectedBundle.sizeBytes) : '.meshbackup'}
              </span>
            </span>
          </button>

          <PasswordField
            label="Bundle password"
            value={restorePassword}
            onChange={(value) => { setRestorePassword(value); setPreview(null) }}
          />

          <NoticeLine notice={restoreNotice} />
          <Button
            variant="secondary"
            className="mt-4 w-full gap-2"
            onClick={handleInspect}
            disabled={!selectedBundle || restorePassword.length < 10 || restoreBusy}
          >
            {restoreBusy && !preview ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            Preview bundle
          </Button>
        </section>
      </div>

      {preview && (
        <section className="mt-4 rounded-lg border border-mesh-green/30 bg-mesh-bg-secondary p-5 shadow-[0_14px_38px_rgba(0,0,0,0.14),inset_3px_0_0_var(--color-mesh-green)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-mesh-green/25 bg-mesh-green/10 text-mesh-green">
                <KeyRound className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-mesh-text-primary">{preview.identity.username}</h3>
                  <span className="rounded border border-mesh-green/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-mesh-green">Verified</span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-mesh-text-muted">{preview.identity.userId}</p>
              </div>
            </div>
            <Button className="gap-2" onClick={handleRestore} disabled={restoreBusy}>
              {restoreBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
              Restore this identity
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-mesh-border/70 bg-mesh-border/70 sm:grid-cols-4">
            <PreviewStat label="Friends" value={preview.counts.friends} />
            <PreviewStat label="Servers" value={preview.counts.servers} />
            <PreviewStat label="Messages" value={preview.counts.directMessages + preview.counts.serverMessages} />
            <PreviewStat label="Files" value={preview.files} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-mesh-text-muted">
            <span>MESH {preview.appVersion}</span>
            <span>{preview.includeHistory ? 'Chat history included' : 'Identity data only'}</span>
            <span>Exported {new Date(preview.exportedAt).toLocaleString()}</span>
          </div>
        </section>
      )}

      <section className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-mesh-border/70 pt-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-mesh-danger/25 bg-mesh-danger/8 text-mesh-danger">
            <UserRoundPlus className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-mesh-text-primary">Create a fresh identity</h3>
            <p className="mt-0.5 text-xs leading-5 text-mesh-text-muted">The current profile is retained in a local rollback archive.</p>
          </div>
        </div>
        <Button variant="danger" onClick={() => setFreshOpen(true)}>Create fresh ID</Button>
      </section>

      <Modal isOpen={freshOpen} onClose={() => !freshBusy && setFreshOpen(false)} title="Create fresh identity">
        <div className="flex gap-3 rounded-md border border-mesh-danger/25 bg-mesh-danger/8 p-3 text-sm text-mesh-text-secondary">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-mesh-danger" />
          <p className="leading-5">You will leave this identity, its friends, servers, and chats after restart.</p>
        </div>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-mesh-text-secondary">Type CREATE FRESH ID to confirm</span>
          <input
            value={freshConfirmation}
            onChange={(event) => setFreshConfirmation(event.target.value)}
            autoFocus
            className="h-9 w-full rounded-md border border-mesh-border bg-mesh-bg-tertiary px-3 font-mono text-sm text-mesh-text-primary outline-none focus:border-mesh-danger focus:ring-1 focus:ring-mesh-danger/25"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setFreshOpen(false)} disabled={freshBusy}>Cancel</Button>
          <Button variant="danger" onClick={handleFreshIdentity} disabled={freshConfirmation !== 'CREATE FRESH ID' || freshBusy}>
            {freshBusy ? 'Preparing' : 'Archive and continue'}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={Boolean(restartResult)} onClose={() => {}} title="Restart MESH">
        <div className="flex flex-col items-center py-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full border border-mesh-green/25 bg-mesh-green/10 text-mesh-green">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <h3 className="mt-3 text-base font-semibold text-mesh-text-primary">{restartResult?.title}</h3>
          <p className="mt-1 max-w-sm text-sm leading-5 text-mesh-text-muted">Restart to load the profile. Rollback archive: {restartResult?.archiveName}</p>
          <Button className="mt-5 w-full gap-2" onClick={() => window.api.recovery.restart()}>
            <RefreshCw className="h-4 w-4" />
            Restart MESH
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function SectionHeading({ icon, title, detail }: { icon: JSX.Element; title: string; detail: string }): JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-mesh-border/70 bg-mesh-bg-tertiary text-mesh-green">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold text-mesh-text-primary">{title}</h3>
        <p className="mt-0.5 text-xs text-mesh-text-muted">{detail}</p>
      </div>
    </div>
  )
}

function PasswordField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  const [visible, setVisible] = useState(false)
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-mesh-text-secondary">{label}</span>
      <span className="flex h-9 items-center rounded-md border border-mesh-border bg-mesh-bg-tertiary transition focus-within:border-mesh-green focus-within:ring-1 focus-within:ring-mesh-green/25">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="new-password"
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-mesh-text-primary outline-none"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="grid h-8 w-8 shrink-0 place-items-center text-mesh-text-muted transition-colors hover:text-mesh-text-primary"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  )
}

function NoticeLine({ notice }: { notice: Notice }): JSX.Element | null {
  if (!notice) return null
  return (
    <p className={`mt-3 text-xs ${notice.tone === 'success' ? 'text-mesh-green' : 'text-mesh-danger'}`}>
      {notice.text}
    </p>
  )
}

function PreviewStat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="bg-mesh-bg-tertiary/75 px-3 py-2.5">
      <span className="block text-base font-semibold text-mesh-text-primary">{value.toLocaleString()}</span>
      <span className="mt-0.5 block text-[10px] font-medium uppercase text-mesh-text-muted">{label}</span>
    </div>
  )
}

export { AccountSettings }
