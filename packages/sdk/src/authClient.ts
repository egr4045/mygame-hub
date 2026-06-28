/**
 * Auth client: passwordless dev login + session persistence. The accountId is stored so a reload
 * re-claims the *same* account (durable identity) — that's what lets the lobby restore your seat.
 */
import type { HandoffResponse, LoginResponse } from '@mygame/protocol';
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
