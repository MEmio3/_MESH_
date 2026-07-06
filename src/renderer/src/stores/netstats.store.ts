import { create } from 'zustand'
import { webrtcManager, type PeerNetStats } from '@/lib/webrtc'

/**
 * Live connection telemetry: per-peer RTT and bitrates plus aggregated
 * totals, fed by webrtcManager's 2-second stats loop. Drives the ping badge
 * and the up/down bandwidth readout in the voice bar and call overlay.
 */
interface NetStatsStore {
  perPeer: Record<string, PeerNetStats>
  /** Total outbound bitrate across all peers (kbps). */
  upKbps: number
  /** Total inbound bitrate across all peers (kbps). */
  downKbps: number
  /** Average RTT across connected peers, ms. Null when nothing is connected. */
  rttMs: number | null
}

export const useNetStatsStore = create<NetStatsStore>(() => ({
  perPeer: {},
  upKbps: 0,
  downKbps: 0,
  rttMs: null
}))

// Compose with any previously-registered handler (defensive, same pattern
// as the other webrtcManager callback consumers).
const prevNetStats = webrtcManager.onNetStats
webrtcManager.onNetStats = (perPeer, totals) => {
  try { prevNetStats?.(perPeer, totals) } catch { /* ignore */ }
  useNetStatsStore.setState({ perPeer, ...totals })
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
