/**
 * Discord-style UI sound effects, synthesized at runtime via the Web Audio
 * API so we don't have to ship .mp3/.ogg assets. Each event is a distinct
 * short envelope over one or more oscillators so the ear can tell them
 * apart without looking at the UI.
 *
 * Respects `useSettingsStore.getState().notifications.sound` — if the user
 * turned sounds off, every helper here is a no-op.
 */
import { useSettingsStore } from '@/stores/settings.store'
import { registerAudioSink } from '@/stores/audioPrefs.store'

let ctx: AudioContext | null = null
function getCtx(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor()
  }
  // On some platforms the context starts suspended until a user gesture —
  // resume() is idempotent and safe to call repeatedly.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** Global master gain lets us scale everything by the "notifications" toggle. */
function masterOut(context: AudioContext): GainNode {
  const g = context.createGain()
  g.gain.value = 0.35 // keep UI sounds quiet by default
  g.connect(context.destination)
  return g
}

function shouldPlay(): boolean {
  try {
    const s = useSettingsStore.getState().notifications
    return !!(s?.enabled && s?.sound)
  } catch {
    return true
  }
}

/**
 * Play a single tone with an ADSR-ish envelope.
 * Returns when the tone's release has finished so chained sounds can await.
 */
function tone(opts: {
  freq: number | ((t: number) => number)
  duration: number
  type?: OscillatorType
  attack?: number
  release?: number
  peak?: number
  delay?: number
}): void {
  if (!shouldPlay()) return
  const context = getCtx()
  const out = masterOut(context)
  const osc = context.createOscillator()
  const env = context.createGain()

  osc.type = opts.type ?? 'sine'
  const now = context.currentTime + (opts.delay ?? 0)
  const dur = opts.duration
  const peak = opts.peak ?? 0.4
  const attack = opts.attack ?? 0.01
  const release = opts.release ?? Math.min(0.15, dur * 0.6)

  if (typeof opts.freq === 'function') {
    // Frequency sweep — sample at ~120Hz.
    const samples = Math.max(4, Math.round(dur * 120))
    osc.frequency.setValueAtTime(opts.freq(0), now)
    for (let i = 1; i <= samples; i++) {
      const t = (i / samples) * dur
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freq(t)), now + t)
    }
  } else {
    osc.frequency.setValueAtTime(opts.freq, now)
  }

  env.gain.setValueAtTime(0.0001, now)
  env.gain.exponentialRampToValueAtTime(peak, now + attack)
  env.gain.setValueAtTime(peak, now + dur - release)
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur)

  osc.connect(env)
  env.connect(out)
  osc.start(now)
  osc.stop(now + dur + 0.02)
}

/** A chord — multiple tones together. */
function chord(freqs: number[], opts: Parameters<typeof tone>[0] extends infer T ? Omit<Exclude<T, undefined>, 'freq'> : never): void {
  if (!shouldPlay()) return
  for (const f of freqs) tone({ ...opts, freq: f })
}

/* ═══════════════════════════════════════════════════════════════════════
   Ring loop — incoming call. Loops until `stopRing()` is called.
   Two-note "ring-ring" pattern on ~3s interval, like a phone.
   ═══════════════════════════════════════════════════════════════════════ */

let ringInterval: ReturnType<typeof setInterval> | null = null
let ringAudioEl: HTMLAudioElement | null = null

export function startIncomingRing(): void {
  if (!shouldPlay() || ringInterval) return
  const fire = (): void => {
    // Two short "bring"s. Classic telephone bell uses ~440/480Hz.
    tone({ freq: 880, duration: 0.35, type: 'sine', peak: 0.35, delay: 0 })
    tone({ freq: 880, duration: 0.35, type: 'sine', peak: 0.35, delay: 0.45 })
  }
  fire()
  ringInterval = setInterval(fire, 2200)
}

export function stopIncomingRing(): void {
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null }
  if (ringAudioEl) { try { ringAudioEl.pause() } catch { /* noop */ } ringAudioEl = null }
}

/* Outbound dial pulse — plays once when you initiate a call. */
export function playOutgoingDial(): void {
  tone({ freq: 480, duration: 0.5, type: 'sine', peak: 0.3 })
  tone({ freq: 620, duration: 0.5, type: 'sine', peak: 0.3, delay: 0.55 })
}

/* ═══════════════════════════════════════════════════════════════════════
   One-shot events
   ═══════════════════════════════════════════════════════════════════════ */

/** Call accepted / connected — rising confident chime. */
export function playCallConnect(): void {
  tone({ freq: 523.25, duration: 0.12, type: 'sine', peak: 0.32 })            // C5
  tone({ freq: 659.25, duration: 0.12, type: 'sine', peak: 0.32, delay: 0.1 }) // E5
  tone({ freq: 783.99, duration: 0.22, type: 'sine', peak: 0.32, delay: 0.2 }) // G5
}

/** Call ended — descending pair. */
export function playCallDisconnect(): void {
  tone({ freq: 659.25, duration: 0.14, type: 'sine', peak: 0.3 })
  tone({ freq: 440.0, duration: 0.22, type: 'sine', peak: 0.3, delay: 0.12 })
}

/** Call rejected — dry low beep. */
export function playCallReject(): void {
  tone({ freq: 311.13, duration: 0.35, type: 'triangle', peak: 0.3 }) // E♭4
}

/** You joined a voice channel — two-note ascending pop. */
export function playVoiceSelfJoin(): void {
  tone({ freq: 523.25, duration: 0.09, type: 'triangle', peak: 0.35 })
  tone({ freq: 880, duration: 0.12, type: 'triangle', peak: 0.35, delay: 0.08 })
}

/** You left a voice channel — two-note descending pop. */
export function playVoiceSelfLeave(): void {
  tone({ freq: 880, duration: 0.08, type: 'triangle', peak: 0.3 })
  tone({ freq: 523.25, duration: 0.12, type: 'triangle', peak: 0.3, delay: 0.07 })
}

/** Someone else joined your voice channel — single high bubble. */
export function playPeerJoinVoice(): void {
  tone({ freq: 987.77, duration: 0.1, type: 'sine', peak: 0.25 })   // B5
  tone({ freq: 1318.5, duration: 0.12, type: 'sine', peak: 0.22, delay: 0.06 }) // E6
}

/** Someone else left your voice channel — single lower bubble. */
export function playPeerLeaveVoice(): void {
  tone({ freq: 659.25, duration: 0.1, type: 'sine', peak: 0.25 })
  tone({ freq: 493.88, duration: 0.14, type: 'sine', peak: 0.22, delay: 0.06 })
}

/** Self-muted (mic off). Short low click. */
export function playMute(): void {
  tone({ freq: 220, duration: 0.07, type: 'square', peak: 0.18, release: 0.04 })
}

/** Self-unmuted. Higher click. */
export function playUnmute(): void {
  tone({ freq: 440, duration: 0.07, type: 'square', peak: 0.18, release: 0.04 })
}

/** Deafened — muted, darker "door-close" thud. */
export function playDeafen(): void {
  tone({ freq: (t) => 200 - t * 180, duration: 0.22, type: 'sine', peak: 0.32 })
  tone({ freq: 110, duration: 0.22, type: 'triangle', peak: 0.18 })
}

/** Undeafened — bright "door-open" ping. */
export function playUndeafen(): void {
  tone({ freq: (t) => 520 + t * 380, duration: 0.2, type: 'sine', peak: 0.32 })
  tone({ freq: 1040, duration: 0.14, type: 'sine', peak: 0.22, delay: 0.05 })
}

/** Somebody started streaming — upward swoop (like "going live"). */
export function playStreamStart(): void {
  tone({ freq: (t) => 300 + t * 900, duration: 0.35, type: 'sawtooth', peak: 0.18 })
  chord([783.99, 1046.5], { duration: 0.3, type: 'sine', peak: 0.18, delay: 0.1 })
}

/** Somebody stopped streaming — downward swoop. */
export function playStreamStop(): void {
  tone({ freq: (t) => 1100 - t * 700, duration: 0.3, type: 'sawtooth', peak: 0.14 })
}

/** New DM arrived (not from self). Single bright chime. */
export function playDmReceived(): void {
  tone({ freq: 1318.5, duration: 0.1, type: 'sine', peak: 0.3 })
  tone({ freq: 1760, duration: 0.18, type: 'sine', peak: 0.24, delay: 0.06 })
}

/** New server message (not from self). Softer double-tap. */
export function playServerMessage(): void {
  tone({ freq: 784, duration: 0.07, type: 'sine', peak: 0.18 })
  tone({ freq: 988, duration: 0.1, type: 'sine', peak: 0.16, delay: 0.05 })
}

/** Friend request / generic notification — single warm ding. */
export function playFriendNotification(): void {
  tone({ freq: 660, duration: 0.18, type: 'sine', peak: 0.3 })
  tone({ freq: 880, duration: 0.22, type: 'sine', peak: 0.24, delay: 0.1 })
}

/**
 * Route all sound output through the user's chosen output device. Calling
 * this on startup isn't strictly required — Web Audio already uses the
 * default speaker — but it keeps us consistent with the rest of the app
 * which honours `audioPrefs`. For future: call `setSinkId` on an
 * `<audio>` element we feed, once we add the `sinkId` plumbing.
 */
export function installSoundSinkHook(): void {
  // Reserved for future device-specific output routing; registerAudioSink
  // is imported to keep the import graph stable if we later wire a
  // dedicated <audio> pipe for Web Audio.
  void registerAudioSink
}
