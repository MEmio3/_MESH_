import Database from 'better-sqlite3'
import { app, dialog } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { gzipSync, gunzipSync } from 'zlib'
import { backupDatabase, closeDatabase, openDatabase } from './database'
import { exportPortableIdentity, importPortableIdentity, type PortableIdentity } from './identity'

const BUNDLE_FORMAT = 'mesh-recovery'
const BUNDLE_VERSION = 1
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024
const MAX_PAYLOAD_FILE_BYTES = 350 * 1024 * 1024
const MAX_DECOMPRESSED_BYTES = 768 * 1024 * 1024
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1

const CORE_PROFILE_ENTRIES = [
  'identity.enc',
  'mesh.db',
  'mesh.db-wal',
  'mesh.db-shm',
  'avatar.png',
  'avatars',
  'server-avatars',
  'downloads'
] as const

const ALWAYS_BACKED_UP_ENTRIES = ['avatar.png', 'avatars', 'server-avatars'] as const

export interface RecoveryCounts {
  friends: number
  servers: number
  conversations: number
  directMessages: number
  serverMessages: number
  settings: number
}

export interface RecoveryManifest {
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
  counts: RecoveryCounts
  files: number
  fileBytes: number
}

interface PayloadFile {
  path: string
  data: string
}

interface RecoveryPayload {
  manifest: RecoveryManifest
  identity: PortableIdentity
  database: string
  files: PayloadFile[]
}

interface RecoveryEnvelope {
  format: typeof BUNDLE_FORMAT
  version: typeof BUNDLE_VERSION
  kdf: {
    name: 'scrypt'
    salt: string
    n: number
    r: number
    p: number
  }
  cipher: {
    name: 'aes-256-gcm'
    iv: string
    tag: string
  }
  ciphertext: string
}

export interface SelectedRecoveryBundle {
  canceled: boolean
  path?: string
  fileName?: string
  sizeBytes?: number
}

function userDataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

function temporaryPath(label: string): string {
  const directory = userDataPath('recovery-temp')
  mkdirSync(directory, { recursive: true })
  return join(directory, `${label}-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`)
}

function removeIfPresent(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true })
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'mesh-user'
}

function assertPassword(password: string): void {
  if (password.length < 10) throw new Error('Use a recovery password with at least 10 characters.')
  if (password.length > 512) throw new Error('The recovery password is too long.')
}

function readCounts(databasePath: string): RecoveryCounts {
  const snapshot = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const count = (table: string): number => {
      const row = snapshot.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }
      return row.total
    }
    return {
      friends: count('friends'),
      servers: count('servers'),
      conversations: count('conversations'),
      directMessages: count('messages') + count('message_request_messages'),
      serverMessages: count('server_messages'),
      settings: count('settings')
    }
  } finally {
    snapshot.close()
  }
}

function stripHistory(databasePath: string): void {
  const snapshot = new Database(databasePath)
  try {
    snapshot.pragma('foreign_keys = ON')
    snapshot.transaction(() => {
      snapshot.exec(`
        DELETE FROM inbox_items;
        DELETE FROM messages;
        DELETE FROM conversations;
        DELETE FROM message_request_messages;
        DELETE FROM message_requests;
        DELETE FROM server_messages;
      `)
    })()
    snapshot.exec('VACUUM')
  } finally {
    snapshot.close()
  }
}

function collectFiles(includeHistory: boolean): { files: PayloadFile[]; totalBytes: number } {
  const roots = includeHistory
    ? [...ALWAYS_BACKED_UP_ENTRIES, 'downloads']
    : [...ALWAYS_BACKED_UP_ENTRIES]
  const files: PayloadFile[] = []
  let totalBytes = 0

  const visit = (absolutePath: string): void => {
    if (!existsSync(absolutePath)) return
    const entry = lstatSync(absolutePath)
    if (entry.isSymbolicLink()) return
    if (entry.isDirectory()) {
      for (const child of readdirSync(absolutePath)) visit(join(absolutePath, child))
      return
    }
    if (!entry.isFile()) return

    totalBytes += entry.size
    if (totalBytes > MAX_PAYLOAD_FILE_BYTES) {
      throw new Error('Managed attachment data exceeds the 350 MB recovery limit. Export without chat history or remove old downloads.')
    }
    const path = relative(app.getPath('userData'), absolutePath).split(sep).join('/')
    files.push({ path, data: readFileSync(absolutePath).toString('base64') })
  }

  for (const root of roots) visit(userDataPath(root))
  return { files, totalBytes }
}

function deriveKey(password: string, salt: Buffer, n = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P): Buffer {
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    throw new Error('This recovery bundle uses unsupported password settings.')
  }
  return scryptSync(password, salt, 32, { N: n, r, p, maxmem: 64 * 1024 * 1024 })
}

function encryptPayload(payload: RecoveryPayload, password: string): RecoveryEnvelope {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = deriveKey(password, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf-8'), { level: 9 })
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kdf: { name: 'scrypt', salt: salt.toString('base64'), n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    ciphertext: ciphertext.toString('base64')
  }
}

function parseEnvelope(path: string): RecoveryEnvelope {
  const size = statSync(path).size
  if (size > MAX_BUNDLE_BYTES) throw new Error('This recovery bundle exceeds the 512 MB limit.')
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<RecoveryEnvelope>
  if (parsed.format !== BUNDLE_FORMAT || parsed.version !== BUNDLE_VERSION || parsed.kdf?.name !== 'scrypt' || parsed.cipher?.name !== 'aes-256-gcm') {
    throw new Error('This is not a supported MESH recovery bundle.')
  }
  return parsed as RecoveryEnvelope
}

function decryptPayload(path: string, password: string): RecoveryPayload {
  assertPassword(password)
  try {
    const envelope = parseEnvelope(path)
    const key = deriveKey(
      password,
      Buffer.from(envelope.kdf.salt, 'base64'),
      envelope.kdf.n,
      envelope.kdf.r,
      envelope.kdf.p
    )
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'))
    const compressed = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ])
    const payload = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString('utf-8')) as RecoveryPayload
    validatePayload(payload)
    return payload
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('supported MESH') ||
      error.message.includes('unsupported password') ||
      error.message.includes('invalid')
    )) throw error
    throw new Error('The password is incorrect or the recovery bundle is damaged.')
  }
}

function validatePayload(payload: RecoveryPayload): void {
  if (!payload || payload.manifest?.formatVersion !== BUNDLE_VERSION || !payload.identity || typeof payload.database !== 'string' || !Array.isArray(payload.files)) {
    throw new Error('The recovery bundle payload is invalid.')
  }
  if (payload.manifest.identity.userId !== payload.identity.userId || payload.manifest.identity.publicKey !== payload.identity.publicKey) {
    throw new Error('The recovery bundle identity metadata is invalid.')
  }
  for (const file of payload.files) validatePayloadPath(file.path)
}

function validatePayloadPath(path: string): void {
  const normalized = path.replace(/\\/g, '/')
  const allowed = normalized === 'avatar.png' || ['avatars/', 'server-avatars/', 'downloads/'].some((root) => normalized.startsWith(root))
  if (!allowed || normalized.startsWith('/') || normalized.includes('../') || normalized.includes('/..')) {
    throw new Error('The recovery bundle contains an invalid file path.')
  }
}

function validateDatabaseBuffer(buffer: Buffer): RecoveryCounts {
  const path = temporaryPath('validate.db')
  try {
    writeFileSync(path, buffer)
    const candidate = new Database(path, { readonly: true, fileMustExist: true })
    try {
      const integrity = candidate.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error('The recovery database failed its integrity check.')
      const required = new Set(['friends', 'servers', 'settings', 'messages', 'server_messages'])
      const rows = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
      for (const name of required) {
        if (!rows.some((row) => row.name === name)) throw new Error('The recovery database is missing required data.')
      }
    } finally {
      candidate.close()
    }
    return readCounts(path)
  } finally {
    removeIfPresent(path)
  }
}

function archiveCurrentProfile(): string {
  closeDatabase()
  const archivesRoot = userDataPath('profile-archives')
  mkdirSync(archivesRoot, { recursive: true })
  const archivePath = join(archivesRoot, new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(archivePath, { recursive: true })
  const moved: string[] = []
  try {
    for (const entry of CORE_PROFILE_ENTRIES) {
      const source = userDataPath(entry)
      if (!existsSync(source)) continue
      renameSync(source, join(archivePath, entry))
      moved.push(entry)
    }
    return archivePath
  } catch (error) {
    for (const entry of moved.reverse()) {
      const archived = join(archivePath, entry)
      if (existsSync(archived)) renameSync(archived, userDataPath(entry))
    }
    removeIfPresent(archivePath)
    openDatabase()
    throw error
  }
}

function restoreArchive(archivePath: string): void {
  closeDatabase()
  for (const entry of CORE_PROFILE_ENTRIES) removeIfPresent(userDataPath(entry))
  for (const entry of readdirSync(archivePath)) {
    renameSync(join(archivePath, entry), userDataPath(entry))
  }
  removeIfPresent(archivePath)
}

function materializePayload(payload: RecoveryPayload): void {
  const database = Buffer.from(payload.database, 'base64')
  validateDatabaseBuffer(database)
  const databasePath = userDataPath('mesh.db')
  writeFileSync(databasePath, database)
  importPortableIdentity(payload.identity)
  const recoveredDownloads = new Map<string, string>()
  for (const file of payload.files) {
    validatePayloadPath(file.path)
    const destination = resolve(app.getPath('userData'), ...file.path.split('/'))
    const userDataRoot = `${resolve(app.getPath('userData'))}${sep}`
    if (!destination.startsWith(userDataRoot)) throw new Error('The recovery bundle contains an unsafe file path.')
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, Buffer.from(file.data, 'base64'))
    if (file.path.startsWith('downloads/')) recoveredDownloads.set(basename(file.path), destination)
  }

  const restoredDatabase = new Database(databasePath)
  try {
    for (const table of ['messages', 'server_messages']) {
      const rows = restoredDatabase.prepare(`SELECT id, file_path AS filePath FROM ${table} WHERE file_path IS NOT NULL`).all() as Array<{ id: string; filePath: string }>
      const update = restoredDatabase.prepare(`UPDATE ${table} SET file_path = ? WHERE id = ?`)
      const rewrite = restoredDatabase.transaction(() => {
        for (const row of rows) update.run(recoveredDownloads.get(basename(row.filePath)) ?? null, row.id)
      })
      rewrite()
    }
  } finally {
    restoredDatabase.close()
  }
}

export async function writeRecoveryBundle(destination: string, password: string, includeHistory: boolean): Promise<RecoveryManifest> {
  assertPassword(password)
  const identity = exportPortableIdentity()
  const databasePath = temporaryPath('export.db')
  try {
    await backupDatabase(databasePath)
    if (!includeHistory) stripHistory(databasePath)
    const database = readFileSync(databasePath)
    const counts = readCounts(databasePath)
    const collected = collectFiles(includeHistory)
    const manifest: RecoveryManifest = {
      formatVersion: BUNDLE_VERSION,
      appVersion: app.getVersion(),
      exportedAt: Date.now(),
      includeHistory,
      identity: {
        userId: identity.userId,
        username: identity.username,
        publicKey: identity.publicKey,
        createdAt: identity.createdAt
      },
      counts,
      files: collected.files.length,
      fileBytes: collected.totalBytes
    }
    const envelope = encryptPayload({
      manifest,
      identity,
      database: database.toString('base64'),
      files: collected.files
    }, password)
    const serialized = JSON.stringify(envelope)
    if (Buffer.byteLength(serialized, 'utf-8') > MAX_BUNDLE_BYTES) {
      throw new Error('The encrypted recovery bundle exceeds the 512 MB limit. Export without chat history or remove old downloads.')
    }
    writeFileSync(destination, serialized, { encoding: 'utf-8', mode: 0o600 })
    return manifest
  } finally {
    removeIfPresent(databasePath)
  }
}

export async function exportRecoveryBundle(password: string, includeHistory: boolean): Promise<{ canceled: boolean; path?: string; manifest?: RecoveryManifest }> {
  assertPassword(password)
  const identity = exportPortableIdentity()
  const date = new Date().toISOString().slice(0, 10)
  const result = await dialog.showSaveDialog({
    title: 'Export encrypted MESH recovery bundle',
    defaultPath: join(app.getPath('documents'), `${sanitizeFileName(identity.username)}-${date}.meshbackup`),
    filters: [{ name: 'MESH Recovery Bundle', extensions: ['meshbackup'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  const manifest = await writeRecoveryBundle(result.filePath, password, includeHistory)
  return { canceled: false, path: result.filePath, manifest }
}

export async function selectRecoveryBundle(): Promise<SelectedRecoveryBundle> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a MESH recovery bundle',
    properties: ['openFile'],
    filters: [{ name: 'MESH Recovery Bundle', extensions: ['meshbackup'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const path = result.filePaths[0]
  return { canceled: false, path, fileName: basename(path), sizeBytes: statSync(path).size }
}

export function inspectRecoveryBundle(path: string, password: string): RecoveryManifest {
  return decryptPayload(path, password).manifest
}

export function restoreRecoveryBundle(path: string, password: string): { success: true; archiveName: string; manifest: RecoveryManifest } {
  const payload = decryptPayload(path, password)
  validateDatabaseBuffer(Buffer.from(payload.database, 'base64'))
  const archivePath = archiveCurrentProfile()
  try {
    materializePayload(payload)
    openDatabase()
    return { success: true, archiveName: basename(archivePath), manifest: payload.manifest }
  } catch (error) {
    restoreArchive(archivePath)
    openDatabase()
    throw error
  }
}

export function createFreshIdentity(confirmation: string): { success: true; archiveName: string } {
  if (confirmation !== 'CREATE FRESH ID') throw new Error('Fresh identity confirmation did not match.')
  const archivePath = archiveCurrentProfile()
  try {
    openDatabase()
    return { success: true, archiveName: basename(archivePath) }
  } catch (error) {
    restoreArchive(archivePath)
    openDatabase()
    throw error
  }
}

export function restartAfterRecovery(): void {
  app.relaunch()
  app.exit(0)
}
