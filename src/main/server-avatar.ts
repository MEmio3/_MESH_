/**
 * Server-avatar file operations. Mirrors `avatar.ts` (user avatars) but keyed
 * by serverId and stored at `userData/server-avatars/<serverId>.png`.
 */

import { app, dialog, nativeImage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, readdirSync } from 'fs'
import { join } from 'path'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const SIZE = 128

function serverAvatarDir(): string {
  const dir = join(app.getPath('userData'), 'server-avatars')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function serverAvatarPath(serverId: string): string {
  return join(serverAvatarDir(), `${serverId}.png`)
}

function resizeToPng(sourcePath: string): Buffer | null {
  const img = nativeImage.createFromPath(sourcePath)
  if (img.isEmpty()) return null
  return img.resize({ width: SIZE, height: SIZE, quality: 'good' }).toPNG()
}

function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`
}

/** Open a file picker and save the chosen image as the avatar for `serverId`. */
export async function pickAndSetServerAvatar(
  serverId: string
): Promise<{ success: boolean; error?: string; dataUrl?: string }> {
  if (!serverId) return { success: false, error: 'missing-server-id' }
  const res = await dialog.showOpenDialog({
    title: 'Choose server avatar',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  })
  if (res.canceled || res.filePaths.length === 0) return { success: false, error: 'cancelled' }
  const src = res.filePaths[0]
  const size = statSync(src).size
  if (size > MAX_BYTES) return { success: false, error: 'File is larger than 2 MB' }
  const png = resizeToPng(src)
  if (!png) return { success: false, error: 'Unsupported image' }
  writeFileSync(serverAvatarPath(serverId), png)
  return { success: true, dataUrl: toDataUrl(png) }
}

export function getServerAvatarDataUrl(serverId: string): string | null {
  const p = serverAvatarPath(serverId)
  if (!existsSync(p)) return null
  const buf = readFileSync(p)
  if (buf.byteLength === 0) return null
  return toDataUrl(buf)
}

/** Snapshot of every server avatar currently on disk, keyed by serverId. */
export function getAllServerAvatars(): Record<string, string> {
  const dir = serverAvatarDir()
  const out: Record<string, string> = {}
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.png')) continue
      const id = name.slice(0, -'.png'.length)
      const buf = readFileSync(join(dir, name))
      if (buf.byteLength === 0) continue
      out[id] = toDataUrl(buf)
    }
  } catch { /* ignore */ }
  return out
}

export function clearServerAvatar(serverId: string): { success: boolean } {
  const p = serverAvatarPath(serverId)
  if (existsSync(p)) {
    try { unlinkSync(p) } catch { /* ignore */ }
  }
  return { success: true }
}
