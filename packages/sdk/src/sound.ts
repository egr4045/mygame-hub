/**
 * Notification sounds. Ships with distinctive **synthesized placeholders** (no bundled audio, no
 * copyright) so testers immediately understand each event's nature; an admin can override any of
 * them with a real clip (a data/URL set via `setCustomSound`, fed from the public platform settings).
 * Respects the per-browser `soundVolume` pref (0 = muted).
 */
import { useNotificationPrefsStore } from './state/notificationPrefsStore.js';

export type SoundKind = 'message' | 'call' | 'achievement';

/** Admin-provided overrides (data URL or absolute URL), keyed by kind. Empty = use the synth. */
const customSounds: Partial<Record<SoundKind, string>> = {};
export const setCustomSound = (kind: SoundKind, url: string | null | undefined): void => {
  if (url) customSounds[kind] = url;
  else delete customSounds[kind];
};

let ctx: AudioContext | null = null;
const getCtx = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

/** A single enveloped tone (quick attack, exponential release) — the building block for the synths. */
const tone = (
  ac: AudioContext,
  freq: number,
  startAt: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'sine',
): void => {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
};

const synth: Record<SoundKind, (ac: AudioContext, vol: number) => void> = {
  // Telegram-ish soft double pop.
  message: (ac, vol) => {
    const t = ac.currentTime;
    tone(ac, 880, t, 0.09, 0.18 * vol, 'sine');
    tone(ac, 1174, t + 0.08, 0.11, 0.16 * vol, 'sine');
  },
  // Skype-ish warm ring: a two-note trill repeated a few times.
  call: (ac, vol) => {
    const t = ac.currentTime;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.42;
      tone(ac, 659, s, 0.18, 0.16 * vol, 'triangle');
      tone(ac, 784, s + 0.16, 0.2, 0.16 * vol, 'triangle');
    }
  },
  // WoW-ish bright ascending fanfare (C–E–G–C major).
  achievement: (ac, vol) => {
    const t = ac.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => tone(ac, f, t + i * 0.1, 0.28, 0.16 * vol, 'square'));
  },
};

export const playSound = (kind: SoundKind): void => {
  const vol = useNotificationPrefsStore.getState().soundVolume;
  if (vol <= 0) return;
  const custom = customSounds[kind];
  if (custom) {
    try {
      const a = new Audio(custom);
      a.volume = vol;
      void a.play().catch(() => {});
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const ac = getCtx();
    if (ac) synth[kind](ac, vol);
  } catch {
    /* WebAudio unavailable — silent */
  }
};

/* ------------------------------------------------------------------------------------------------
 * Call loops. A real incoming call rings for 45–60s — one 1.2s blip (the old behavior) was trivially
 * missed. `startRingtone` loops until an explicit stop from the call lifecycle (accept / decline /
 * hangup / timeout / disconnect — chatStore owns every exit). `startRingback` is the quieter
 * caller-side "line is ringing" cadence.
 * ---------------------------------------------------------------------------------------------- */

const RING_PHRASE_MS = 1900; // synth.call phrase ≈ 1.26s + a natural pause
const RINGBACK_PHRASE_MS = 3000; // classic ~1s tone / ~2s silence cadence

let ringTimer: ReturnType<typeof setInterval> | null = null;
let ringAudio: HTMLAudioElement | null = null;
let ringbackTimer: ReturnType<typeof setInterval> | null = null;
/** Which loop is *wanted* right now — lets the gesture-unlock handler start a pending loop late. */
let wantLoop: 'ringtone' | 'ringback' | null = null;

/** True when WebAudio is actually able to produce sound right now (autoplay policy satisfied). */
export const isAudioReady = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!ctx && ctx.state === 'running';
};

const ringbackPhrase = (ac: AudioContext, vol: number): void => {
  const t = ac.currentTime;
  // Single soft 425 Hz burst (European ringback), quieter than the callee's ringtone.
  tone(ac, 425, t, 0.9, 0.07 * vol, 'sine');
};

const startLoop = (kind: 'ringtone' | 'ringback'): void => {
  wantLoop = kind;
  stopLoopTimersOnly();
  const vol = (): number => useNotificationPrefsStore.getState().soundVolume;

  if (kind === 'ringtone' && customSounds.call) {
    try {
      ringAudio = new Audio(customSounds.call);
      ringAudio.loop = true;
      ringAudio.volume = vol();
      void ringAudio.play().catch(() => {
        /* autoplay blocked — the gesture-unlock listener restarts us */
      });
    } catch {
      /* ignore */
    }
    return;
  }

  const phrase = (): void => {
    const v = vol();
    if (v <= 0) return; // muted — keep looping silently so a live volume change is heard
    try {
      const ac = getCtx();
      if (!ac || ac.state !== 'running') return; // suspended — unlock listener will resume
      if (kind === 'ringtone') synth.call(ac, v);
      else ringbackPhrase(ac, v);
    } catch {
      /* ignore */
    }
  };
  phrase();
  const t = setInterval(phrase, kind === 'ringtone' ? RING_PHRASE_MS : RINGBACK_PHRASE_MS);
  if (kind === 'ringtone') ringTimer = t;
  else ringbackTimer = t;
};

const stopLoopTimersOnly = (): void => {
  if (ringTimer) clearInterval(ringTimer);
  if (ringbackTimer) clearInterval(ringbackTimer);
  ringTimer = null;
  ringbackTimer = null;
  if (ringAudio) {
    ringAudio.pause();
    ringAudio = null;
  }
};

/** Loop the incoming-call ringtone until stopped. Idempotent. */
export const startRingtone = (): void => startLoop('ringtone');
/** Loop the caller-side ringback until stopped. Idempotent. */
export const startRingback = (): void => startLoop('ringback');

/** Stop every call-related loop. Safe to call from all call-lifecycle exits. */
export const stopAllCallSounds = (): void => {
  wantLoop = null;
  stopLoopTimersOnly();
};

let unlockInstalled = false;
/**
 * Autoplay policies keep the AudioContext `suspended` until a user gesture. Install once per page:
 * the first pointerdown/keydown resumes the context and (re)starts any loop that is still wanted —
 * so a ring that began on a fresh tab becomes audible the moment the user touches anything.
 */
export const installGestureUnlock = (): void => {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const unlock = (): void => {
    try {
      const ac = getCtx();
      if (ac && ac.state === 'suspended') void ac.resume();
    } catch {
      /* ignore */
    }
    if (wantLoop) startLoop(wantLoop);
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
};
