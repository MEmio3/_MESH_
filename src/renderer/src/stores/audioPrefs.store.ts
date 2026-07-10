/**
 * Global audio device + volume preferences.
 *
 * Single source of truth for:
 *   - Which microphone to capture from (`inputDeviceId`)
 *   - Which speaker to render remote audio through (`outputDeviceId`)
 *   - Input volume (0..100) — applied via a Web Audio GainNode inserted in
 *     the capture graph by `webrtcManager`.
 *   - Output volume (0..100) — applied to every remote `<audio>` / `<video>`
 *     element that subscribes via `applyOutputVolume(el)`.
 *
 * Both 1-to-1 calls (`call.store`) and voice rooms (`voice.store`) read from
 * here so the user only configures devices once, Discord-style, from the
 * user panel at the bottom of the sidebar.
 */

import { create } from 'zustand'
import { mediaEngine } from '@/lib/media-engine'

const LS_INPUT = 'mesh.audio.input'
const LS_OUTPUT = 'mesh.audio.output'
const LS_IN_VOL = 'mesh.audio.inputVolume'
const LS_OUT_VOL = 'mesh.audio.outputVolume'
const LS_USER_VOLUMES = 'mesh.audio.userVolumes'

function readLS(key: string, fallback: string | null = null): string | null {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
function writeLS(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* ignore */ }
}
function readNum(key: string, fallback: number): number {
  const raw = readLS(key)
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}
function readUserVolumes(): Record<string, number> {
  const raw = readLS(LS_USER_VOLUMES)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: Record<string, number> = {}
    for (const [userId, value] of Object.entries(parsed)) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) next[userId] = Math.max(0, Math.min(200, Math.round(numeric)))
    }
    return next
  } catch {
    return {}
  }
}

interface AudioPrefsState {
  inputDeviceId: string | null   // microphone
  outputDeviceId: string | null  // speaker / headphones
  inputVolume: number            // 0..100
  outputVolume: number           // 0..100
  userVolumes: Record<string, number> // per remote user, 0..200

  setInputDevice: (deviceId: string | null) => Promise<void>
  setOutputDevice: (deviceId: string | null) => void
  setInputVolume: (value: number) => void
  setOutputVolume: (value: number) => void
  setUserVolume: (userId: string, value: number) => void
}

export const useAudioPrefsStore = create<AudioPrefsState>((set, get) => ({
  inputDeviceId: readLS(LS_INPUT),
  outputDeviceId: readLS(LS_OUTPUT),
  inputVolume: readNum(LS_IN_VOL, 100),
  outputVolume: readNum(LS_OUT_VOL, 100),
  userVolumes: readUserVolumes(),

  setInputDevice: async (deviceId) => {
    writeLS(LS_INPUT, deviceId)
    set({ inputDeviceId: deviceId })
    // If a mic stream is already live, swap it mid-call.
    try {
      if (mediaEngine.hasMic()) {
        await mediaEngine.replaceMicDevice(deviceId || undefined)
      }
    } catch (err) {
      console.error('Failed to switch microphone:', err)
    }
  },

  setOutputDevice: (deviceId) => {
    writeLS(LS_OUTPUT, deviceId)
    set({ outputDeviceId: deviceId })
    applyOutputToAllSinks(deviceId)
  },

  setInputVolume: (value) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)))
    writeLS(LS_IN_VOL, String(clamped))
    set({ inputVolume: clamped })
    try { mediaEngine.setInputGain(clamped / 100) } catch { /* ignore */ }
  },

  setOutputVolume: (value) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)))
    writeLS(LS_OUT_VOL, String(clamped))
    set({ outputVolume: clamped })
    applyVolumeToAllSinks()
  },

  setUserVolume: (userId, value) => {
    const clamped = Math.max(0, Math.min(200, Math.round(value)))
    const next = { ...get().userVolumes, [userId]: clamped }
    writeLS(LS_USER_VOLUMES, JSON.stringify(next))
    set({ userVolumes: next })
    applyVolumeToAllSinks()
  }
}))

/* -----------------------------------------------------------
 * Playback sink registry.
 *
 * Any component that renders a remote `<audio>` or `<video>`
 * element should register it here so the global output device
 * and volume settings are applied automatically.
 * --------------------------------------------------------- */
type Sink = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }
const sinks = new Map<Sink, string | null>()

export function registerAudioSink(el: HTMLMediaElement | null, userId: string | null = null): () => void {
  if (!el) return () => { /* no-op */ }
  sinks.set(el as Sink, userId)
  // Apply current settings immediately.
  const { outputDeviceId } = useAudioPrefsStore.getState()
  applySinkDevice(el as Sink, outputDeviceId)
  applySinkVolume(el as Sink, userId)
  return () => { sinks.delete(el as Sink) }
}

function applySinkDevice(el: Sink, deviceId: string | null): void {
  if (!el.setSinkId) return
  el.setSinkId(deviceId || 'default').catch((err) => {
    // Not fatal — some browsers/devices reject setSinkId; fall back to default.
    console.warn('setSinkId failed:', err)
  })
}

function applyOutputToAllSinks(deviceId: string | null): void {
  sinks.forEach((_userId, el) => applySinkDevice(el, deviceId))
}

function applySinkVolume(el: Sink, userId: string | null): void {
  const { outputVolume, userVolumes } = useAudioPrefsStore.getState()
  const userVolume = userId ? (userVolumes[userId] ?? 100) : 100
  el.volume = Math.max(0, Math.min(1, (outputVolume / 100) * (userVolume / 100)))
}

function applyVolumeToAllSinks(): void {
  sinks.forEach((userId, el) => applySinkVolume(el, userId))
}
