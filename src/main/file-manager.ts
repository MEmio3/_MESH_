/**
 * File manager for saving/reading transferred files.
 * Files are stored in {userData}/downloads/.
 */
import { app, dialog } from 'electron'
import { join, extname, basename } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'fs'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

function getDownloadsDir(): string {
  const dir = join(app.getPath('userData'), 'downloads')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getClipboardDir(): string {
  const dir = join(app.getPath('temp'), 'MESH', 'clipboard')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Stage a clipboard File in a temporary directory so the existing attachment
 * transport can read it through the same path-based API as picked files. */
export function saveClipboardFile(fileName: string, fileType: string, data: Buffer): string {
  if (data.byteLength > MAX_FILE_SIZE) throw new Error('File exceeds the 50 MB attachment limit.')

  const extensionByType: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'text/plain': '.txt',
    'application/pdf': '.pdf'
  }
  const original = basename(fileName || 'clipboard-file')
  const existingExt = extname(original)
  const fallbackExt = extensionByType[fileType] || ''
  const stem = existingExt ? original.slice(0, -existingExt.length) : original
  const safeStem = stem.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'clipboard-file'
  const ext = (existingExt || fallbackExt).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12)
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const filePath = join(getClipboardDir(), `${unique}_${safeStem}${ext}`)
  writeFileSync(filePath, data)
  return filePath
}

/** Save a received file (raw Buffer) to userData/downloads/ and return the path. */
export function saveReceivedFile(
  fileId: string,
  fileName: string,
  data: Buffer
): string {
  const dir = getDownloadsDir()
  const ext = extname(fileName)
  const baseName = fileName.replace(ext, '')
  // Use fileId to avoid name collisions
  const safeName = `${baseName}_${fileId.slice(0, 8)}${ext}`
  const filePath = join(dir, safeName)
  writeFileSync(filePath, data)
  return filePath
}

/** Read a local file for sending. Returns { buffer, fileName, fileSize, fileType }. */
export function readFileForSend(filePath: string): {
  buffer: Buffer
  fileName: string
  fileSize: number
  fileType: string
} | null {
  if (!existsSync(filePath)) return null
  const stat = statSync(filePath)
  if (stat.size > MAX_FILE_SIZE) return null

  const buffer = readFileSync(filePath)
  const fileName = filePath.split(/[\\/]/).pop() || 'file'
  const ext = extname(fileName).toLowerCase()

  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
  }
  const fileType = mimeMap[ext] || 'application/octet-stream'

  return { buffer, fileName, fileSize: stat.size, fileType }
}

/** Open native file picker dialog and return selected file path. */
export async function pickFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'] },
      { name: 'Documents', extensions: ['pdf', 'txt', 'json', 'zip', 'rar', '7z'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/** Check if a file exists on disk. */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath)
}

/** Read file as base64 for inline preview (images only). */
export function readFileAsBase64(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const buffer = readFileSync(filePath)
  return buffer.toString('base64')
}

export function getMaxFileSize(): number {
  return MAX_FILE_SIZE
}
