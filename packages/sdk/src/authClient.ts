/**
 * Auth client: passwordless dev login + session persistence. The accountId is stored so a reload
 * re-claims the *same* account (durable identity) — that's what lets the lobby restore your seat.
 */
import type {
  HandoffResponse,
  LoginResponse,
  TelegramLinkResponse,
  TelegramStatusResponse,
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

/** Log in (or re-claim `accountId`) and persist the fresh tokens. */
export const login = async (displayName: string, accountId?: string): Promise<Session> => {
  const res = await fetch(`${config.authUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, accountId }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  const session = (await res.json()) as LoginResponse;
  saveSession(session);
  return session;
};

/**
 * Get a fresh access token for the stored account. Login is passwordless, so re-claiming the same
 * account id re-mints tokens — this avoids 401s from a stale (15m) access token before authed calls.
 */
const freshAccessToken = async (): Promise<string | null> => {
  const s = loadSession();
  if (!s) return null;
  try {
    return (await login(s.displayName, s.accountId)).accessToken;
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

/**
 * Mint a short-lived handoff token to carry this session into another game (via its URL `?pt=` or a
 * QR code). The long-lived access/refresh tokens never leave here — the target game exchanges the
 * handoff token at its own `POST /auth/platform`. Returns null if not logged in / on failure.
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
