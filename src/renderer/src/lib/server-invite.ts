import { decodeConnectionCode, encodeConnectionCode } from './connection-code'
import { MESH_PROTOCOL_VERSION } from '../../../shared/protocol'

export const SERVER_INVITE_VERSION = 1

export interface ParsedServerInvite {
  serverId: string
  hostUrl: string | null
  hostUrls: string[]
  serverName: string | null
  version: number
  protocolVersion: number | null
  legacy: boolean
}

export function normalizeInviteHost(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().replace(/[),.]+$/, '')
  if (!raw) return null
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withProtocol)
    if (!url.hostname || !url.port || !['http:', 'https:'].includes(url.protocol)) return null
    const port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function uniqueInviteHosts(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const hosts: string[] = []
  for (const value of values) {
    const normalized = normalizeInviteHost(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    hosts.push(normalized)
  }
  return hosts
}

export function createServerInvite(args: { serverId: string; hostUrl: string; hostUrls?: string[]; serverName?: string | null }): string {
  const hosts = uniqueInviteHosts([args.hostUrl, ...(args.hostUrls ?? [])])
  const hostUrl = hosts[0] ?? null
  if (!/^srv_[A-Za-z0-9_-]+$/.test(args.serverId) || !hostUrl) return ''
  const params = new URLSearchParams({
    v: String(SERVER_INVITE_VERSION),
    server: args.serverId,
    code: encodeConnectionCode(hostUrl),
    protocol: String(MESH_PROTOCOL_VERSION)
  })
  for (const route of hosts.slice(1)) params.append('route', encodeConnectionCode(route))
  const serverName = String(args.serverName ?? '').trim().slice(0, 80)
  if (serverName) params.set('name', serverName)
  return `mesh://join?${params.toString()}`
}

export function parseServerInvite(input: string): ParsedServerInvite | null {
  const raw = input.trim()
  if (!raw || raw.length > 4096) return null

  try {
    const url = new URL(raw)
    if (url.protocol === 'mesh:' && (url.hostname === 'join' || url.pathname.replace(/^\//, '') === 'join')) {
      const serverId = url.searchParams.get('server') || url.searchParams.get('serverId') || ''
      if (!/^srv_[A-Za-z0-9_-]+$/.test(serverId)) return null
      const version = Number.parseInt(url.searchParams.get('v') || '1', 10)
      if (!Number.isInteger(version) || version < 1 || version > SERVER_INVITE_VERSION) return null
      const code = url.searchParams.get('code')
      const hostUrl = normalizeInviteHost(code ? decodeConnectionCode(code) : url.searchParams.get('host'))
      if (!hostUrl) return null
      const hostUrls = uniqueInviteHosts([
        hostUrl,
        ...url.searchParams.getAll('route').map((route) => decodeConnectionCode(route) ?? route)
      ])
      const protocol = Number.parseInt(url.searchParams.get('protocol') || '', 10)
      return {
        serverId,
        hostUrl,
        hostUrls,
        serverName: url.searchParams.get('name')?.trim().slice(0, 80) || null,
        version,
        protocolVersion: Number.isInteger(protocol) ? protocol : null,
        legacy: !code
      }
    }
  } catch {
    /* Continue with legacy text parsing. */
  }

  const serverId = raw.match(/srv_[A-Za-z0-9_-]+/)?.[0] ?? ''
  if (!serverId) return null
  const codeMatch = raw.match(/MESH-[A-Za-z0-9_-]+/i)?.[0]
  const decodedHost = codeMatch ? decodeConnectionCode(codeMatch) : null
  const hostMatch = raw.match(/https?:\/\/[^\s/]+(?::\d+)?/i)?.[0]
    ?? raw.match(/(?:\b|^)(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9.-]+\.[a-z]{2,})(?::\d{1,5})(?:\b|$)/i)?.[0]
  return {
    serverId,
    hostUrl: normalizeInviteHost(decodedHost ?? hostMatch),
    hostUrls: uniqueInviteHosts([decodedHost ?? hostMatch]),
    serverName: null,
    version: 1,
    protocolVersion: null,
    legacy: true
  }
}
