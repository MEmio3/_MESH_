export type NetworkAddressFamily = 'ipv4' | 'ipv6'

export function stripAddressBrackets(address: string): string {
  const trimmed = address.trim()
  return trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed
}

export function networkAddressFamily(address: string): NetworkAddressFamily | null {
  const value = stripAddressBrackets(address).split('%')[0]
  if (value.includes(':')) return 'ipv6'
  const parts = value.split('.')
  if (parts.length !== 4) return null
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const octet = Number(part)
    return octet >= 0 && octet <= 255
  }) ? 'ipv4' : null
}

export function isGlobalIpv6Address(address: string | null | undefined): boolean {
  if (!address || networkAddressFamily(address) !== 'ipv6') return false
  const first = Number.parseInt(stripAddressBrackets(address).split('%')[0].split(':')[0] || '0', 16)
  return Number.isFinite(first) && first >= 0x2000 && first <= 0x3fff
}

export function isPrivateOrCgnatAddress(address: string | null | undefined): boolean {
  if (!address) return false
  const value = stripAddressBrackets(address).split('%')[0].toLowerCase()
  const family = networkAddressFamily(value)
  if (family === 'ipv6') {
    if (value === '::' || value === '::1') return true
    const first = Number.parseInt(value.split(':')[0] || '0', 16)
    if (!Number.isFinite(first)) return true
    if (first >= 0xfc00 && first <= 0xfdff) return true
    if (first >= 0xfe80 && first <= 0xfebf) return true
    return first >= 0xff00
  }
  if (family !== 'ipv4') return false
  const [a, b] = value.split('.').map(Number)
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return a === 169 && b === 254
}

export function formatHttpHost(address: string, port: number, protocol: 'http' | 'https' = 'http'): string {
  const raw = stripAddressBrackets(address)
  const host = networkAddressFamily(raw) === 'ipv6'
    ? `[${raw.replace('%', '%25')}]`
    : raw
  return `${protocol}://${host}:${port}`
}
