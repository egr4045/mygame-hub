/**
 * Platform store — the account session (shared login) and which game is selected. This is the
 * game-agnostic layer: you log in once here, then pick a game whose own lobby/store takes over.
 * Account identity is durable (persisted), so a reload restores you to the hub (and, inside a
 * game, to your seat).
 */
import { create } from 'zustand';
import { clearSession, loadSession, login as apiLogin } from '../net/authClient.js';

export type PlatformStatus = 'idle' | 'logging-in' | 'ready' | 'error';

const GAME_KEY = 'civa.game';
const readGame = (): string | null => {
  try {
    return localStorage.getItem(GAME_KEY);
  } catch {
    return null;
  }
};

interface PlatformState {
  account: { accountId: string; displayName: string } | null;
  selectedGame: string | null;
  status: PlatformStatus;
  error: string | null;

  login: (displayName: string) => Promise<void>;
  logout: () => void;
  selectGame: (id: string) => void;
  exitGame: () => void;
  /** Re-claim the stored account on load (so the hub shows you logged in). */
  restore: () => void;
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  account: null,
  selectedGame: null,
  status: 'idle',
  error: null,

  login: async (displayName) => {
    set({ status: 'logging-in', error: null });
    try {
      const prev = loadSession();
      const s = await apiLogin(displayName, prev?.accountId);
      set({ account: { accountId: s.accountId, displayName: s.displayName }, status: 'ready' });
    } catch (e) {
      set({ status: 'error', error: String(e) });
    }
  },

  logout: () => {
    clearSession();
    try {
      localStorage.removeItem(GAME_KEY);
    } catch {
      /* ignore */
    }
    set({ account: null, selectedGame: null, status: 'idle', error: null });
  },

  selectGame: (id) => {
    try {
      localStorage.setItem(GAME_KEY, id);
    } catch {
      /* ignore */
    }
    set({ selectedGame: id });
  },
  exitGame: () => {
    try {
      localStorage.removeItem(GAME_KEY);
    } catch {
      /* ignore */
    }
    set({ selectedGame: null });
  },

  restore: () => {
    const prev = loadSession();
    if (prev && !get().account) {
      set({
        account: { accountId: prev.accountId, displayName: prev.displayName },
        selectedGame: readGame(),
        status: 'ready',
      });
    }
  },
}));
