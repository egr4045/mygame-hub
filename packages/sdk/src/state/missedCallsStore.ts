/**
 * Missed calls the CLIENT witnessed (a ring that ended in timeout / caller-cancel / busy-line while
 * we were still `ringing-in`). Persisted locally so a reload doesn't erase the record; the server
 * keeps no call log yet, so a callee who was fully offline during the ring still learns nothing —
 * flagged follow-up (server-side call-log message in expireRing), out of scope for this pass.
 *
 * Surfaces: derived system rows in the conversation timeline, launcher/app-bar badge counts, and
 * 🔔 bell entries. `markSeen(conversationId)` fires when that chat is opened.
 */
import { create } from 'zustand';
import { loadJson, saveJson } from '../utils/storage.js';

export interface MissedCall {
  conversationId: string;
  fromName: string;
  type: 'audio' | 'video';
  /** ms epoch of the miss (client clock). */
  at: number;
  seen: boolean;
  /** Busy-line miss (auto-declined while in another call). The server can't know about these, so
   *  they have NO server call-log message — numeric badges count only busy misses to avoid
   *  double-counting against the unread system message that covers every other miss. */
  busy?: boolean;
}

interface MissedCallsState {
  missed: MissedCall[];
  addMissed: (entry: Omit<MissedCall, 'seen' | 'at'> & { at?: number }) => void;
  markSeen: (conversationId: string) => void;
  clearAll: () => void;
}

const KEY = 'mygame.missedCalls';
const CAP = 50;

export const useMissedCallsStore = create<MissedCallsState>((set) => ({
  missed: loadJson<MissedCall[]>(KEY, []).filter(
    (m) => m && typeof m.conversationId === 'string' && Number.isFinite(m.at),
  ),

  addMissed: (entry) =>
    set((s) => {
      const missed = [...s.missed, { ...entry, at: entry.at ?? Date.now(), seen: false }].slice(-CAP);
      saveJson(KEY, missed);
      return { missed };
    }),

  markSeen: (conversationId) =>
    set((s) => {
      if (!s.missed.some((m) => m.conversationId === conversationId && !m.seen)) return s;
      const missed = s.missed.map((m) => (m.conversationId === conversationId ? { ...m, seen: true } : m));
      saveJson(KEY, missed);
      return { missed };
    }),

  clearAll: () =>
    set(() => {
      saveJson(KEY, []);
      return { missed: [] };
    }),
}));

/** Unseen-miss count — drives the 🔔 bell badge and per-conversation markers. */
export const selectUnseenMissed = (s: MissedCallsState): number => s.missed.filter((m) => !m.seen).length;

/** Unseen BUSY misses only — the addend for numeric unread badges (see `MissedCall.busy`). */
export const selectUnseenBusyMissed = (s: MissedCallsState): number =>
  s.missed.filter((m) => !m.seen && m.busy).length;
