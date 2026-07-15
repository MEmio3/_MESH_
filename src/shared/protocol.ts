export const MESH_PROTOCOL_VERSION = 1
export const MESH_MIN_PROTOCOL_VERSION = 1

export type CompatibilityStatus = 'checking' | 'compatible' | 'update-recommended' | 'incompatible' | 'legacy'

export interface CompatibilityHello {
  appVersion: string
  protocolVersion: number
  minProtocolVersion: number
}

export interface CompatibilityResponse {
  compatible: boolean
  status: 'compatible' | 'update-recommended' | 'incompatible'
  hostAppVersion: string
  hostProtocolVersion: number
  hostMinProtocolVersion: number
  message: string
}

export function protocolRangesOverlap(
  localVersion: number,
  localMinimum: number,
  remoteVersion: number,
  remoteMinimum: number
): boolean {
  return localMinimum <= remoteVersion && remoteMinimum <= localVersion
}

function numericVersion(version: string): number[] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : null
}

export function compareAppVersions(left: string, right: string): number {
  const a = numericVersion(left)
  const b = numericVersion(right)
  if (!a || !b) return left === right ? 0 : 0
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return 0
}

export function evaluateCompatibility(
  client: CompatibilityHello,
  host: { appVersion: string; protocolVersion: number; minProtocolVersion: number }
): CompatibilityResponse {
  const compatible = protocolRangesOverlap(
    client.protocolVersion,
    client.minProtocolVersion,
    host.protocolVersion,
    host.minProtocolVersion
  )
  if (!compatible) {
    return {
      compatible: false,
      status: 'incompatible',
      hostAppVersion: host.appVersion,
      hostProtocolVersion: host.protocolVersion,
      hostMinProtocolVersion: host.minProtocolVersion,
      message: `Protocol ranges do not overlap. Client supports ${client.minProtocolVersion}-${client.protocolVersion}; host supports ${host.minProtocolVersion}-${host.protocolVersion}.`
    }
  }

  const versionsDiffer = client.appVersion !== host.appVersion
  const versionOrder = compareAppVersions(client.appVersion, host.appVersion)
  const versionMessage = versionOrder < 0
    ? `Host runs newer MESH ${host.appVersion}; update this app from ${client.appVersion}.`
    : versionOrder > 0
      ? `Host runs older MESH ${host.appVersion}; connection is compatible, but the host should update.`
      : `Compatible protocol, but app versions differ (${client.appVersion} and ${host.appVersion}).`
  return {
    compatible: true,
    status: versionsDiffer ? 'update-recommended' : 'compatible',
    hostAppVersion: host.appVersion,
    hostProtocolVersion: host.protocolVersion,
    hostMinProtocolVersion: host.minProtocolVersion,
    message: versionsDiffer ? versionMessage : `Compatible with MESH ${host.appVersion}.`
  }
}
