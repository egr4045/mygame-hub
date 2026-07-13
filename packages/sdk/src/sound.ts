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
