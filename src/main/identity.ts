import sodium from 'libsodium-wrappers'
import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { hostname, userInfo } from 'os'

const IDENTITY_FILE = 'identity.enc'

interface StoredIdentity {
  publicKey: string
  encryptedPrivateKey: string
  salt: string
  userId: string
  username: string
  avatarColor: string | null
  createdAt: number
  useSafeStorage: boolean
}

function getIdentityPath(): string {
  return join(app.getPath('userData'), IDENTITY_FILE)
}

export async function initSodium(): Promise<void> {
  console.log('[identity] initializing libsodium...')
  const start = Date.now()
  await sodium.ready
  console.log('[identity] libsodium initialized in', Date.now() - start, 'ms')
}

/**
 * Encrypt private key using OS-level encryption (safeStorage) or fallback.
 * Private key material NEVER leaves the main process.
 */
function encryptPrivateKey(privateKeyHex: string): { encrypted: string; salt: string; useSafeStorage: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(privateKeyHex)
    return {
      encrypted: encrypted.toString('base64'),
      salt: '',
      useSafeStorage: true
    }
  }

  // Fallback: derive key from machine-specific values
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
  const machineId = `${hostname()}:${userInfo().username}:${app.getPath('userData')}`
  const machineHash = sodium.crypto_generichash(32, sodium.from_string(machineId))

  // Derive an encryption key from machine hash + salt
  const key = sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, new Uint8Array([...machineHash, ...salt]))
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(
    sodium.from_string(privateKeyHex),
    nonce,
    key
  )

  // Pack nonce + ciphertext together
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encrypted: sodium.to_base64(packed),
    salt: sodium.to_base64(salt),
    useSafeStorage: false
  }
}

/**
 * Decrypt private key from stored format.
 */
function decryptPrivateKey(stored: StoredIdentity): string {
  if (stored.useSafeStorage) {
    const buffer = Buffer.from(stored.encryptedPrivateKey, 'base64')
    return safeStorage.decryptString(buffer)
  }

  // Fallback decryption
  const salt = sodium.from_base64(stored.salt)
  const machineId = `${hostname()}:${userInfo().username}:${app.getPath('userData')}`
  const machineHash = sodium.crypto_generichash(32, sodium.from_string(machineId))

  const key = sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, new Uint8Array([...machineHash, ...salt]))

  const packed = sodium.from_base64(stored.encryptedPrivateKey)
  const nonce = packed.slice(0, sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = packed.slice(sodium.crypto_secretbox_NONCEBYTES)

  const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key)
  return sodium.to_string(decrypted)
}

/**
 * Generate a real Ed25519 keypair, encrypt and save to disk.
 * Returns only the public-facing identity data (no private key).
 */
export async function generateIdentity(
  username: string,
  avatarColor: string | null
): Promise<{ userId: string; publicKey: string }> {
  await sodium.ready
  console.log('[identity] generating keypair for:', username)

  try {
    const keypair = sodium.crypto_sign_keypair()
    const publicKeyHex = sodium.to_hex(keypair.publicKey)
    const privateKeyHex = sodium.to_hex(keypair.privateKey)
    const userId = `usr_${publicKeyHex.substring(0, 16)}`

    const { encrypted, salt, useSafeStorage } = encryptPrivateKey(privateKeyHex)

    const stored: StoredIdentity = {
      publicKey: publicKeyHex,
      encryptedPrivateKey: encrypted,
      salt,
      userId,
      username,
      avatarColor,
      createdAt: Date.now(),
      useSafeStorage
    }

    writeFileSync(getIdentityPath(), JSON.stringify(stored, null, 2), 'utf-8')
    console.log('[identity] keypair generated successfully, userId:', userId)

    return { userId, publicKey: publicKeyHex }
  } catch (err) {
    console.error('[identity] keypair generation failed:', err)
    throw err
  }
}

/**
 * Check if an identity file exists on disk.
 */
export function identityExists(): boolean {
  return existsSync(getIdentityPath())
}

/**
 * Load identity from disk. Returns all fields EXCEPT the private key.
 * Private key never leaves the main process.
 */
export function loadIdentity(): {
  userId: string
  publicKey: string
  username: string
  avatarColor: string | null
  createdAt: number
} | null {
  const path = getIdentityPath()
  if (!existsSync(path)) return null

  try {
    const raw = readFileSync(path, 'utf-8')
    const stored: StoredIdentity = JSON.parse(raw)
    return {
      userId: stored.userId,
      publicKey: stored.publicKey,
      username: stored.username,
      avatarColor: stored.avatarColor,
      createdAt: stored.createdAt
    }
  } catch {
    return null
  }
}

/**
 * Get the decrypted private key. INTERNAL USE ONLY — never expose via IPC.
 */
export function getPrivateKey(): Uint8Array {
  const path = getIdentityPath()
  const raw = readFileSync(path, 'utf-8')
  const stored: StoredIdentity = JSON.parse(raw)
  const privateKeyHex = decryptPrivateKey(stored)
  return sodium.from_hex(privateKeyHex)
}

/**
 * Sign a message with the identity's private key.
 * Returns a detached Ed25519 signature.
 */
export function signMessage(message: Uint8Array): Uint8Array {
  const privateKey = getPrivateKey()
  return sodium.crypto_sign_detached(message, privateKey)
}

export async function hashPassword(password: string): Promise<string> {
  await sodium.ready
  const hash = sodium.crypto_generichash(32, sodium.from_string(password))
  return sodium.to_hex(hash)
}
