import { create } from 'zustand'
import { mediaEngine } from '@/lib/media-engine'

/**
 * Live connection telemetry fed by the media engine's 2-second loop:
 * socket round-trip to the host plus media throughput. Drives the ping
 * badge and the up/down bandwidth readout in the voice bar and calls.
 */
interface NetStatsStore {
  /** Total outbound media bitrate (kbps). */
  upKbps: number
  /** Total inbound media bitrate (kbps). */
  downKbps: number
  /** Round-trip to the host, ms. Null when no media session is active. */
  rttMs: number | null
}

export const useNetStatsStore = create<NetStatsStore>(() => ({
  upKbps: 0,
  downKbps: 0,
  rttMs: null
}))

const prevStats = mediaEngine.onStats
mediaEngine.onStats = (stats) => {
  try { prevStats?.(stats) } catch { /* ignore */ }
  useNetStatsStore.setState(stats)
}

/** Format kbps for display: "512 kbps" / "1.4 Mbps". */
export function formatKbps(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
  return `${kbps} kbps`
}

/** Traffic-light class for a ping value. */
export function pingTone(rttMs: number | null): string {
  if (rttMs === null) return 'text-mesh-text-muted'
  if (rttMs < 60) return 'text-mesh-green'
  if (rttMs < 150) return 'text-mesh-warning'
  return 'text-mesh-danger'
}
