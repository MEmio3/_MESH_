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
import { webrtcManager } from '@/lib/webrtc'

const LS_INPUT = 'mesh.audio.input'
const LS_OUTPUT = 'mesh.audio.output'
const LS_IN_VOL = 'mesh.audio.inputVolume'
const LS_OUT_VOL = 'mesh.audio.outputVolume'

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

interface AudioPrefsState {
  inputDeviceId: string | null   // microphone
  outputDeviceId: string | null  // speaker / headphones
  inputVolume: number            // 0..100
  outputVolume: number           // 0..100

  setInputDevice: (deviceId: string | null) => Promise<void>
  setOutputDevice: (deviceId: string | null) => void
  setInputVolume: (value: number) => void
  setOutputVolume: (value: number) => void
}

export const useAudioPrefsStore = create<AudioPrefsState>((set, get) => ({
  inputDeviceId: readLS(LS_INPUT),
  outputDeviceId: readLS(LS_OUTPUT),
  inputVolume: readNum(LS_IN_VOL, 100),
  outputVolume: readNum(LS_OUT_VOL, 100),

  setInputDevice: async (deviceId) => {
    writeLS(LS_INPUT, deviceId)
    set({ inputDeviceId: deviceId })
    // If a mic stream is already live, swap it mid-call without renegotiating.
    try {
      if (webrtcManager.hasLocalAudio?.()) {
        await webrtcManager.replaceAudioDevice(deviceId || undefined)
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
    try { webrtcManager.setInputGain?.(clamped / 100) } catch { /* ignore */ }
  },

  setOutputVolume: (value) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)))
    writeLS(LS_OUT_VOL, String(clamped))
    set({ outputVolume: clamped })
    applyVolumeToAllSinks(clamped / 100)
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
const sinks = new Set<Sink>()

export function registerAudioSink(el: HTMLMediaElement | null): () => void {
  if (!el) return () => { /* no-op */ }
  sinks.add(el as Sink)
  // Apply current settings immediately.
  const { outputDeviceId, outputVolume } = useAudioPrefsStore.getState()
  applySinkDevice(el as Sink, outputDeviceId)
  el.volume = outputVolume / 100
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
  sinks.forEach((el) => applySinkDevice(el, deviceId))
}

function applyVolumeToAllSinks(vol: number): void {
  sinks.forEach((el) => { el.volume = vol })
}
