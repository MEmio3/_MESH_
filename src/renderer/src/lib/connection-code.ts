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
const MULTI_PREFIX = 'MESH2-'
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

function obfuscate(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b ^ KEY)
  return base64UrlEncode(bin)
}

function deobfuscate(value: string): string {
  const bin = base64UrlDecode(value)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)).map((b) => b ^ KEY)
  return new TextDecoder().decode(bytes)
}

function normalizeDecodedHost(hostPort: string): string | null {
  const value = hostPort.trim()
  if (!value || !/^[\w.[\]:%-]+$/.test(value)) return null
  const candidate = /^https?:\/\//i.test(value) ? value : `http://${value}`
  try {
    const url = new URL(candidate)
    const port = Number(url.port)
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

/** Encode a host URL/address into a shareable `MESH-...` code. Empty in → "". */
export function encodeConnectionCode(url: string): string {
  const hostPort = toHostPort(url)
  if (!hostPort) return ''
  return `${PREFIX}${obfuscate(hostPort)}`
}

/** Encode several equivalent routes into one smart connection code. */
export function encodeConnectionRoutes(urls: string[]): string {
  const routes = [...new Set(urls.map(toHostPort).filter(Boolean))]
  if (routes.length === 0) return ''
  if (routes.length === 1) return encodeConnectionCode(routes[0])
  return `${MULTI_PREFIX}${obfuscate(JSON.stringify(routes.slice(0, 16)))}`
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
    return normalizeDecodedHost(deobfuscate(m[1]))
  } catch {
    return null
  }
}


/** Decode either a legacy one-route code or a smart multi-route code. */
export function decodeConnectionRoutes(input: string): string[] | null {
  const raw = input.trim()
  const multi = /^mesh2-([A-Za-z0-9\-_]+)$/i.exec(raw)
  if (!multi) {
    const single = decodeConnectionCode(raw)
    return single ? [single] : null
  }
  try {
    const decoded = JSON.parse(deobfuscate(multi[1])) as unknown
    if (!Array.isArray(decoded)) return null
    const routes = [...new Set(decoded
      .slice(0, 16)
      .map((value) => typeof value === 'string' ? normalizeDecodedHost(value) : null)
      .filter((value): value is string => Boolean(value)))]
    return routes.length > 0 ? routes : null
  } catch {
    return null
  }
}

/**
 * Resolve whatever the user pasted into a connectable URL: a MESH code decodes
 * back to its address; anything else is returned as-is for normal URL handling.
 */
export function resolveConnectionInput(input: string): string {
  return decodeConnectionRoutes(input)?.[0] ?? input
}

/** True when the string looks like a MESH connection code. */
export function isConnectionCode(input: string): boolean {
  return /^mesh2?-[A-Za-z0-9\-_]+$/i.test(input.trim())
}
