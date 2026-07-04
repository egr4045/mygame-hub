import { z } from 'zod';

/**
 * Auth contract (HTTP). Dev login is passwordless — a player just claims a display name and gets
 * an account + JWTs. The account is the durable identity; sessions bind to it, not to a tab.
 */

export const loginRequest = z.object({
  displayName: z.string().min(1).max(32),
  /** Optional: re-claim an existing account id (e.g. persisted in localStorage). */
  accountId: z.string().optional(),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const loginResponse = z.object({
  accountId: z.string(),
  displayName: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  avatarIcon: z.string().optional(),
});
export type LoginResponse = z.infer<typeof loginResponse>;

export const socialLoginRequest = z.object({
  network: z.enum(['telegram', 'vk']),
  recoveryCode: z.string()
});
export type SocialLoginRequest = z.infer<typeof socialLoginRequest>;

/**
 * Telegram account linking. The hub (authenticated) asks for a one-time code; the user opens the bot
 * via `url` (`https://t.me/<bot>?start=<code>`) which binds their Telegram chat to the account. To log
 * in on another device, the user sends `/login` to the bot and redeems the returned code via
 * `socialLoginRequest`.
 */
export const telegramLinkResponse = z.object({
  code: z.string(),
  /** Deep link to the bot with the code prefilled. Empty if the bot username is unknown. */
  url: z.string(),
});
export type TelegramLinkResponse = z.infer<typeof telegramLinkResponse>;

export const telegramStatusResponse = z.object({
  linked: z.boolean(),
  telegramId: z.string().optional(),
});
export type TelegramStatusResponse = z.infer<typeof telegramStatusResponse>;

export const refreshRequest = z.object({ refreshToken: z.string() });
export type RefreshRequest = z.infer<typeof refreshRequest>;

export const refreshResponse = z.object({ accessToken: z.string() });
export type RefreshResponse = z.infer<typeof refreshResponse>;

/**
 * Handoff: mint a short-lived token to carry identity to *another* game (via a URL `?pt=` param or
 * a QR code) without exposing the long-lived access/refresh tokens. The target game exchanges it at
 * its own `POST /auth/platform` for a game-native session. Authorized by the holder's refresh token.
 */
export const handoffRequest = z.object({ refreshToken: z.string() });
export type HandoffRequest = z.infer<typeof handoffRequest>;

export const handoffResponse = z.object({
  handoffToken: z.string(),
  accountId: z.string(),
  displayName: z.string(),
});
export type HandoffResponse = z.infer<typeof handoffResponse>;

/** Verified JWT claims. `sub` is the accountId. */
export interface AuthClaims {
  sub: string;
  name: string;
  /**
   * - `access` — authenticates a socket/request.
   * - `refresh` — only mints new access/handoff tokens; cannot authenticate a socket.
   * - `handoff` — short-lived, single hop to another game's `/auth/platform`.
   */
  typ: 'access' | 'refresh' | 'handoff';
}
