import { z } from 'zod';

/**
 * Auth contract (HTTP). Players register a display name and password to get an account + JWTs.
 * The account is the durable identity; sessions bind to it, not to a tab.
 */

export const loginRequest = z.object({
  displayName: z.string().min(1).max(32),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const registerRequest = z.object({
  displayName: z.string().min(1).max(32),
  password: z.string().min(1),
});
export type RegisterRequest = z.infer<typeof registerRequest>;

export const loginResponse = z.object({
  accountId: z.string(),
  displayName: z.string(),
  /** Short human-dictatable friend code (optional for back-compat with older servers). */
  friendCode: z.string().optional(),
  accessToken: z.string(),
  refreshToken: z.string(),
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
 * a QR code) without exposing the long-lived access/refresh tokens. The target game exchanges it via
 * `exchangeRequest` below (auth's own `POST /auth/exchange`) for a session on its own origin.
 * Authorized by the holder's refresh token.
 */
export const handoffRequest = z.object({ refreshToken: z.string() });
export type HandoffRequest = z.infer<typeof handoffRequest>;

export const handoffResponse = z.object({
  handoffToken: z.string(),
  accountId: z.string(),
  displayName: z.string(),
});
export type HandoffResponse = z.infer<typeof handoffResponse>;

/**
 * Exchange a handoff token (minted by `/auth/handoff`) for a full session on the target game's own
 * origin — this is how a game embedding the SDK establishes identity via the hub's `?pt=` deep link
 * without ever seeing a password. The server verifies the token's signature + `typ: 'handoff'` itself
 * (the client never needs to decode/trust it locally).
 */
export const exchangeRequest = z.object({ handoffToken: z.string() });
export type ExchangeRequest = z.infer<typeof exchangeRequest>;

/**
 * Profile customization: avatar + wallpaper images and a "title" achievement badge shown across
 * every game. Images are uploaded as data URLs and stored on the account row — no object storage
 * service exists yet, so a size cap keeps this reasonable (see docs/ARCHITECTURE.md). `titleAchievement`
 * references one of the account's own unlocked achievements (`gameId` + `achievementId`); the server
 * rejects setting a title the account doesn't actually hold.
 */
const MAX_DATA_URL_CHARS = 2_500_000; // ~1.8MB decoded, comfortably covers a compressed avatar/wallpaper

export const titleAchievementRef = z
  .object({ gameId: z.string().min(1), achievementId: z.string().min(1) })
  .nullable();
export type TitleAchievementRef = z.infer<typeof titleAchievementRef>;

export const setAvatarRequest = z.object({ dataUrl: z.string().min(1).max(MAX_DATA_URL_CHARS) });
export type SetAvatarRequest = z.infer<typeof setAvatarRequest>;

export const setWallpaperRequest = z.object({ dataUrl: z.string().min(1).max(MAX_DATA_URL_CHARS) });
export type SetWallpaperRequest = z.infer<typeof setWallpaperRequest>;

export const setTitleRequest = z.object({ titleAchievement: titleAchievementRef });
export type SetTitleRequest = z.infer<typeof setTitleRequest>;

export const setFavoritesRequest = z.object({ gameIds: z.array(z.string().min(1)) });
export type SetFavoritesRequest = z.infer<typeof setFavoritesRequest>;

export const changePasswordRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>;

export const changeDisplayNameRequest = z.object({ displayName: z.string().min(1).max(32) });
export type ChangeDisplayNameRequest = z.infer<typeof changeDisplayNameRequest>;

export const profileResponse = z.object({
  avatarIcon: z.string().nullable(),
  wallpaper: z.string().nullable(),
  titleAchievement: titleAchievementRef,
  favoriteGameIds: z.array(z.string()),
  /** Short human-dictatable friend code (optional for back-compat with older servers). */
  friendCode: z.string().optional(),
});
export type ProfileResponse = z.infer<typeof profileResponse>;

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
