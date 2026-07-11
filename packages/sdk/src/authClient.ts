/**
 * Auth client: login + session persistence. The accountId is stored so a reload
 * re-hydrates the token without a login screen.
 */
import type {
  AchievementsResponse,
  GrantAchievementResponse,
  HandoffResponse,
  LoginResponse,
  ProfileResponse,
  TelegramLinkResponse,
  TelegramStatusResponse,
  TitleAchievementRef,
} from '@mygame/protocol';
import { config } from './config.js';

export interface Session {
  accountId: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
}

const KEY = 'civa.session';

export const loadSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

export const saveSession = (s: Session): void => localStorage.setItem(KEY, JSON.stringify(s));
export const clearSession = (): void => localStorage.removeItem(KEY);

export const login = async (displayName: string, password?: string): Promise<Session> => {
  const res = await fetch(`${config.authUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, password }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  const session = (await res.json()) as LoginResponse;
  saveSession(session);
  return session;
};

export const register = async (displayName: string, password?: string): Promise<Session> => {
  const res = await fetch(`${config.authUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, password }),
  });
  if (!res.ok) throw new Error(`register failed (${res.status})`);
  const session = (await res.json()) as LoginResponse;
  saveSession(session);
  return session;
};

/**
 * Get a fresh access token for the stored account using the refresh token. 
 * This avoids 401s from a stale (15m) access token before authed calls.
 * Exported for sibling clients (stats, community) that also need an authed call without duplicating
 * the refresh dance.
 */
export const freshAccessToken = async (): Promise<string | null> => {
  const s = loadSession();
  if (!s) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    });
    if (!res.ok) return null;
    const { accessToken } = await res.json() as { accessToken: string };
    saveSession({ ...s, accessToken });
    return accessToken;
  } catch {
    return null;
  }
};

/** Ask the auth service for a Telegram link code + deep link (authenticated). Null on failure. */
export const createTelegramLinkCode = async (): Promise<TelegramLinkResponse | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/telegram/link-code`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as TelegramLinkResponse;
  } catch {
    return null;
  }
};

/** Whether the current account has a linked Telegram. Null on failure. */
export const getTelegramStatus = async (): Promise<TelegramStatusResponse | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/telegram/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as TelegramStatusResponse;
  } catch {
    return null;
  }
};

/** Log in by redeeming a one-time code the bot issued via /login. Persists the session. Null on failure. */
export const loginWithTelegram = async (recoveryCode: string): Promise<Session | null> => {
  try {
    const res = await fetch(`${config.authUrl}/auth/social/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ network: 'telegram', recoveryCode }),
    });
    if (!res.ok) return null;
    const session = (await res.json()) as LoginResponse;
    saveSession(session);
    return session;
  } catch {
    return null;
  }
};

/** Grant (idempotently) an achievement for `gameId` to the current account. Null on failure. */
export const grantAchievement = async (gameId: string, achievementId: string): Promise<GrantAchievementResponse | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/achievements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ gameId, achievementId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as GrantAchievementResponse;
  } catch {
    return null;
  }
};

/** The current account's unlocked achievements, across every game. Null on failure. */
export const getAchievements = async (): Promise<AchievementsResponse | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/achievements`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as AchievementsResponse;
  } catch {
    return null;
  }
};

/** The current account's profile customization (avatar/wallpaper/title). Null on failure. */
export const getProfile = async (): Promise<ProfileResponse | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/profile`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as ProfileResponse;
  } catch {
    return null;
  }
};

/** Set the profile avatar to a data URL (read the file with `FileReader.readAsDataURL`). Null on failure
 *  (including if the server rejects an oversized image). */
export const setAvatar = async (dataUrl: string): Promise<string | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/profile/avatar`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { avatarIcon: string | null }).avatarIcon;
  } catch {
    return null;
  }
};

/** Set the profile wallpaper to a data URL. Null on failure. */
export const setWallpaper = async (dataUrl: string): Promise<string | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/profile/wallpaper`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { wallpaper: string | null }).wallpaper;
  } catch {
    return null;
  }
};

/**
 * Set (or clear, with `null`) the "title" badge shown across every game. The server rejects a
 * reference to an achievement the account hasn't actually unlocked. Returns false on failure/reject.
 */
export const setTitleAchievement = async (ref: TitleAchievementRef): Promise<boolean> => {
  const token = await freshAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${config.authUrl}/auth/profile/title`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ titleAchievement: ref }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/** Change the current account's password. `false` on failure (including a wrong `currentPassword`). */
export const changePassword = async (currentPassword: string, newPassword: string): Promise<boolean> => {
  const token = await freshAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${config.authUrl}/auth/profile/password`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Rename the current account (accountId is unchanged). The server mints fresh tokens with the new name
 * baked in (a JWT's `name` claim is fixed at mint time) and this replaces the whole cached session with
 * them, same as `login`/`register` — a locally-patched `displayName` alone would leave the *old* name
 * resurfacing on every other service's socket auth until the next full login. `false` on failure
 * (including if the name is already taken).
 */
export const changeDisplayName = async (displayName: string): Promise<boolean> => {
  const token = await freshAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${config.authUrl}/auth/profile/display-name`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName }),
    });
    if (!res.ok) return false;
    saveSession((await res.json()) as Session);
    return true;
  } catch {
    return false;
  }
};

/** Replace the account's full list of favorited game ids. Returns false on failure. */
export const setFavorites = async (gameIds: string[]): Promise<boolean> => {
  const token = await freshAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${config.authUrl}/auth/profile/favorites`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ gameIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Redeem a handoff token (from `?pt=` in the URL) for a full session on this origin — the server
 * verifies the token itself, so this never needs to see/trust a password. Persists the session on
 * success. Null on failure (expired/invalid token, or the account no longer exists).
 */
export const exchangeHandoff = async (handoffToken: string): Promise<Session | null> => {
  try {
    const res = await fetch(`${config.authUrl}/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handoffToken }),
    });
    if (!res.ok) return null;
    const session = (await res.json()) as LoginResponse;
    saveSession(session);
    return session;
  } catch {
    return null;
  }
};

/**
 * Mint a short-lived handoff token to carry this session into another game (via its URL `?pt=` or a
 * QR code). The long-lived access/refresh tokens never leave here — the target game exchanges the
 * handoff token at its own origin via `exchangeHandoff`/`mygame.auth.loginWithToken`. Returns null if
 * not logged in / on failure.
 */
export const getHandoff = async (): Promise<string | null> => {
  const s = loadSession();
  if (!s) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as HandoffResponse).handoffToken;
  } catch {
    return null;
  }
};
