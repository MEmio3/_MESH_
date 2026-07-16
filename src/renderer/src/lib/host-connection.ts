import { normalizeInviteHost } from './server-invite'

type HostStatus = Awaited<ReturnType<typeof window.api.signaling.listHostStatuses>>[number]

export interface HostConnectionResult {
  url: string
  status: HostStatus
  becamePrimary: boolean
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sameHost(left: string, right: string): boolean {
  return normalizeInviteHost(left)?.toLowerCase() === normalizeInviteHost(right)?.toLowerCase()
}

export async function ensureHostConnection(hostUrl: string, userId: string): Promise<HostConnectionResult> {
  const normalized = normalizeInviteHost(hostUrl)
  if (!normalized) throw new Error('This invitation contains an invalid host address.')

  let statuses = await window.api.signaling.listHostStatuses()
  let current = statuses.find((status) => sameHost(status.url, normalized))
  let becamePrimary = false

  if (!current) {
    const alreadyConnected = statuses.some((status) => status.state === 'connected')
      || await window.api.signaling.isConnected()
    if (alreadyConnected) {
      const result = await window.api.signaling.addHost(normalized)
      if (!result.success) throw new Error('Could not add the invited host to your active networks.')
    } else {
      await window.api.signaling.connect(normalized, userId)
      becamePrimary = true
    }
  }

  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    statuses = await window.api.signaling.listHostStatuses()
    current = statuses.find((status) => sameHost(status.url, normalized))
    if (current?.compatibilityStatus === 'incompatible') {
      throw new Error(current.compatibilityMessage || 'This host uses an incompatible MESH version.')
    }
    if (current?.state === 'connected' && current.compatibilityStatus !== 'checking') {
      return { url: normalized, status: current, becamePrimary }
    }
    await pause(200)
  }

  throw new Error(current?.error || 'The invited host did not become reachable in time.')
}
