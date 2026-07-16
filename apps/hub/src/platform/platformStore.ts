/**
 * Platform store — the account session (shared login) and which game is selected. This is the
 * game-agnostic layer: you log in once here, then pick a game whose own lobby/store takes over.
 * Account identity is durable (persisted), so a reload restores you to the hub (and, inside a
 * game, to your seat).
 */
import { create } from 'zustand';
import {
  clearSession,
  loadSession,
  login as apiLogin,
  register as apiRegister,
  loginWithTelegram,
  getProfile,
  setFavorites as apiSetFavorites,
} from '@mygame/sdk';

export type PlatformStatus = 'idle' | 'logging-in' | 'ready' | 'error';

const GAME_KEY = 'gamehub.game';
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
  /** Favorited game ids, persisted server-side (`auth`'s account row) — hydrated on login/restore. */
  favoriteGameIds: string[];

  login: (displayName: string, password?: string) => Promise<void>;
  register: (displayName: string, password?: string) => Promise<void>;
  /** Log in by redeeming a one-time code sent by the Telegram bot (/login). */
  loginWithTelegramCode: (code: string) => Promise<void>;
  logout: () => void;
  selectGame: (id: string) => void;
  exitGame: () => void;
  /** Re-claim the stored account on load (so the hub shows you logged in). */
  restore: () => void;
  toggleFavorite: (gameId: string) => void;
  /** Reflect a display-name change already applied server-side (`@mygame/sdk`'s `changeDisplayName`)
   *  in the cached account — that call replaces the session's tokens/name but doesn't touch this store. */
  renameAccount: (displayName: string) => void;
}

/** Best-effort: populate favorites once we have a session, without blocking the login flow on it. */
const hydrateFavorites = (set: (partial: Partial<PlatformState>) => void): void => {
  void getProfile().then((p) => {
    if (p) set({ favoriteGameIds: p.favoriteGameIds });
  });
};

// Read the persisted session synchronously at store-creation time so the very first render already
// knows we're logged in — returning from a game (a full page reload) then renders the hub directly
// instead of flashing the AuthScreen for a frame while an effect-driven `restore()` catches up.
const bootSession = (() => {
  try {
    return loadSession();
  } catch {
    return null;
  }
})();

export const usePlatformStore = create<PlatformState>((set, get) => ({
  account: bootSession ? { accountId: bootSession.accountId, displayName: bootSession.displayName } : null,
  selectedGame: bootSession ? readGame() : null,
  status: bootSession ? 'ready' : 'idle',
  error: null,
  favoriteGameIds: [],

  login: async (displayName, password) => {
    set({ status: 'logging-in', error: null });
    try {
      const s = await apiLogin(displayName, password);
      set({ account: { accountId: s.accountId, displayName: s.displayName }, status: 'ready' });
      hydrateFavorites(set);
    } catch (e) {
      set({ status: 'error', error: 'Неверный логин или пароль' });
    }
  },

  register: async (displayName, password) => {
    set({ status: 'logging-in', error: null });
    try {
      const s = await apiRegister(displayName, password);
      set({ account: { accountId: s.accountId, displayName: s.displayName }, status: 'ready' });
      hydrateFavorites(set);
    } catch (e) {
      set({ status: 'error', error: 'Имя уже занято или ошибка регистрации' });
    }
  },

  loginWithTelegramCode: async (code) => {
    set({ status: 'logging-in', error: null });
    const session = await loginWithTelegram(code.trim());
    if (!session) {
      set({ status: 'error', error: 'Неверный или истёкший код' });
      return;
    }
    set({ account: { accountId: session.accountId, displayName: session.displayName }, status: 'ready' });
    hydrateFavorites(set);
  },

  logout: () => {
    clearSession();
    try {
      localStorage.removeItem(GAME_KEY);
    } catch {
      /* ignore */
    }
    set({ account: null, selectedGame: null, status: 'idle', error: null, favoriteGameIds: [] });
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
    if (!prev) return;
    // account is usually already set synchronously at store creation (bootSession); only set it here
    // if something cleared it. Either way, (re)hydrate favorites from the server.
    if (!get().account) {
      set({
        account: { accountId: prev.accountId, displayName: prev.displayName },
        selectedGame: readGame(),
        status: 'ready',
      });
    }
    hydrateFavorites(set);
  },

  toggleFavorite: (gameId) => {
    const current = get().favoriteGameIds;
    const next = current.includes(gameId) ? current.filter((id) => id !== gameId) : [...current, gameId];
    set({ favoriteGameIds: next }); // optimistic — matches the rest of this store's style
    void apiSetFavorites(next);
  },

  renameAccount: (displayName) => {
    const account = get().account;
    if (account) set({ account: { ...account, displayName } });
  },
}));
