/**
 * MESH connection codes.
 *
 * Instead of handing someone a bare `http://10.32.106.49:3000`, we share an
 * opaque token like `MESH-...`. The address is encoded (not encrypted) so it
 * isn't plainly visible in the UI or when pasted into chats — a raw IP on the
 * open internet invites unsolicited probing. Anyone with the code can still
 * decode it (that's the point — it's an invite), this just keeps the address
 * out of plain sight.
 *
 * The scheme is deliberately simple and fully reversible:
 *   strip scheme -> UTF-8 bytes -> XOR with a fixed key -> base64url, prefixed.
 */

const PREFIX = 'MESH-'
// Fixed obfuscation key. NOT a secret — the codec is public and reversible by
// design. It only exists so a base64 decode alone doesn't spit out the IP.
const KEY = 0x5a

/** "http://10.0.0.5:3000/" -> "10.0.0.5:3000" */
function toHostPort(url: string): string {
  return url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

function base64UrlEncode(bin: string): string {
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) b64 += '='
  return atob(b64)
}

/** Encode a host URL/address into a shareable `MESH-...` code. Empty in → "". */
export function encodeConnectionCode(url: string): string {
  const hostPort = toHostPort(url)
  if (!hostPort) return ''
  const bytes = new TextEncoder().encode(hostPort)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b ^ KEY)
  return `${PREFIX}${base64UrlEncode(bin)}`
}

/**
 * Decode a `MESH-...` code back into a normalized `http://host:port` URL.
 * Returns null if the input isn't a valid MESH code (so callers can fall back
 * to treating the input as a raw address).
 */
export function decodeConnectionCode(input: string): string | null {
  const raw = input.trim()
  const m = /^mesh-([A-Za-z0-9\-_]+)$/i.exec(raw)
  if (!m) return null
  try {
    const bin = base64UrlDecode(m[1])
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)).map((b) => b ^ KEY)
    const hostPort = new TextDecoder().decode(bytes).trim()
    if (!hostPort || !/^[\w.[\]:-]+$/.test(hostPort)) return null
    return /^https?:\/\//i.test(hostPort) ? hostPort : `http://${hostPort}`
  } catch {
    return null
  }
}

/**
 * Resolve whatever the user pasted into a connectable URL: a MESH code decodes
 * back to its address; anything else is returned as-is for normal URL handling.
 */
export function resolveConnectionInput(input: string): string {
  return decodeConnectionCode(input) ?? input
}

/** True when the string looks like a MESH connection code. */
export function isConnectionCode(input: string): boolean {
  return /^mesh-[A-Za-z0-9\-_]+$/i.test(input.trim())
}
