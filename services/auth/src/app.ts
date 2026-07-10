import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Clock, Logger } from '@mygame/shared-types';
import {
  grantAchievementRequest,
  handoffRequest,
  heartbeatRequest,
  loginRequest,
  recordEnterRequest,
  refreshRequest,
  setAdminRoleRequest,
  setAvatarRequest,
  setFavoritesRequest,
  setTitleRequest,
  setWallpaperRequest,
  socialLoginRequest,
} from '@mygame/protocol';
import type { AdminAccountSummary, AuthClaims } from '@mygame/protocol';
import type { AuthCore } from '@mygame/auth-core';
import { TokenError } from '@mygame/auth-core';
import type { AccountStore } from './store.js';
import type { GameStatsStore } from './statsStore.js';
import type { TelegramLinking } from './telegramLinking.js';

/**
 * Auth HTTP app: passwordless login, token refresh, SSO handoff, and Telegram linking/login.
 * Dependencies are injected as ports so the same app runs with real or fake adapters (the isolation
 * contract). `telegram` is optional — when unset (no bot token) the Telegram routes return 501.
 */
export interface AppDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly auth: AuthCore;
  readonly accounts: AccountStore;
  readonly stats: GameStatsStore;
  readonly telegram?: TelegramLinking | undefined;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
};

/** Thrown by `readJson` when the body exceeds `maxBytes` — mapped to 413 by the top-level handler. */
class PayloadTooLargeError extends Error {}

/** Reads and JSON-parses the body, aborting (rather than buffering unbounded data) past `maxBytes`. */
const readJson = async (req: IncomingMessage, maxBytes = 200_000): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) throw new PayloadTooLargeError('payload too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const bearer = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
};

/** Verify the caller's access token; on failure it writes a 401 and returns null. */
const requireAccount = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: AppDeps,
): Promise<AuthClaims | null> => {
  const token = bearer(req);
  if (!token) {
    send(res, 401, { code: 'unauthorized', message: 'missing access token' });
    return null;
  }
  try {
    const claims = await deps.auth.verify(token);
    if (claims.typ !== 'access') {
      send(res, 401, { code: 'unauthorized', message: 'not an access token' });
      return null;
    }
    return claims;
  } catch {
    send(res, 401, { code: 'unauthorized', message: 'invalid access token' });
    return null;
  }
};

/** `requireAccount` plus an `isAdmin` check — 401 if not logged in, 403 if logged in but not an
 *  admin. Auth owns `accounts` directly, so this reads the flag straight off the store (no mirroring
 *  needed here, unlike community/orchestrator which don't own the accounts table). */
const requireAdmin = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: AppDeps,
): Promise<AuthClaims | null> => {
  const claims = await requireAccount(req, res, deps);
  if (!claims) return null;
  if (!deps.accounts.get(claims.sub)?.isAdmin) {
    send(res, 403, { code: 'forbidden', message: 'admin access required' });
    return null;
  }
  return claims;
};

const toAdminSummary = (a: NonNullable<ReturnType<AccountStore['get']>>): AdminAccountSummary => ({
  id: a.id,
  displayName: a.displayName,
  isAdmin: a.isAdmin,
  telegramLinked: !!a.telegramId,
  achievementCount: a.achievements.length,
});

export const createApp = (deps: AppDeps): Server =>
  createServer((req, res) => {
    void handle(req, res, deps).catch((err) => {
      if (res.headersSent) return;
      if (err instanceof PayloadTooLargeError) {
        send(res, 413, { code: 'validation', message: 'payload too large' });
        return;
      }
      deps.logger.error('unhandled', { err: String(err) });
      send(res, 500, { code: 'internal', message: 'internal error' });
    });
  });

async function handle(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  const { method, url } = req;

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (url === '/health' || url === '/ready') {
    send(res, 200, { status: 'ok', service: 'auth', now: deps.clock.now() });
    return;
  }

  if (method === 'POST' && url === '/auth/login') {
    const parsed = loginRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid login', details: parsed.error.flatten() });
      return;
    }
    const account = deps.accounts.upsert(parsed.data.displayName, parsed.data.accountId);
    const [accessToken, refreshToken] = await Promise.all([
      deps.auth.signAccess(account.id, account.displayName),
      deps.auth.signRefresh(account.id, account.displayName),
    ]);
    deps.logger.info('login', { accountId: account.id });
    send(res, 200, { accountId: account.id, displayName: account.displayName, accessToken, refreshToken });
    return;
  }

  if (method === 'POST' && url === '/auth/refresh') {
    const parsed = refreshRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid refresh' });
      return;
    }
    try {
      const claims = await deps.auth.verify(parsed.data.refreshToken);
      if (claims.typ !== 'refresh') {
        send(res, 401, { code: 'unauthorized', message: 'not a refresh token' });
        return;
      }
      const accessToken = await deps.auth.signAccess(claims.sub, claims.name);
      send(res, 200, { accessToken });
    } catch (err) {
      const reason = err instanceof TokenError ? err.reason : 'invalid';
      send(res, 401, { code: 'unauthorized', message: `refresh ${reason}` });
    }
    return;
  }

  // Mint a short-lived handoff token (carries identity to another game via URL/QR). Authorized by
  // the holder's refresh token; the target game exchanges it at its own POST /auth/platform.
  if (method === 'POST' && url === '/auth/handoff') {
    const parsed = handoffRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid handoff' });
      return;
    }
    try {
      const claims = await deps.auth.verify(parsed.data.refreshToken);
      if (claims.typ !== 'refresh') {
        send(res, 401, { code: 'unauthorized', message: 'not a refresh token' });
        return;
      }
      const handoffToken = await deps.auth.signHandoff(claims.sub, claims.name);
      deps.logger.info('handoff', { accountId: claims.sub });
      send(res, 200, { handoffToken, accountId: claims.sub, displayName: claims.name });
    } catch (err) {
      const reason = err instanceof TokenError ? err.reason : 'invalid';
      send(res, 401, { code: 'unauthorized', message: `handoff ${reason}` });
    }
    return;
  }

  // --- Telegram linking & login --------------------------------------------------------------
  // Mint a one-time link code bound to the caller's account (authenticated by access token).
  if (method === 'POST' && url === '/auth/telegram/link-code') {
    if (!deps.telegram) {
      send(res, 501, { code: 'internal', message: 'telegram linking not configured' });
      return;
    }
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const { code, url: deepLink } = deps.telegram.createLinkCode(claims.sub);
    send(res, 200, { code, url: deepLink });
    return;
  }

  // Whether the caller's account has a linked Telegram.
  if (method === 'GET' && url === '/auth/telegram/status') {
    if (!deps.telegram) {
      send(res, 200, { linked: false });
      return;
    }
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    send(res, 200, deps.telegram.statusFor(claims.sub));
    return;
  }

  // Log in by redeeming a one-time code the bot issued via /login (carry identity to a new device).
  if (method === 'POST' && url === '/auth/social/login') {
    const parsed = socialLoginRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid social login' });
      return;
    }
    if (parsed.data.network !== 'telegram' || !deps.telegram) {
      send(res, 400, { code: 'validation', message: 'unsupported network' });
      return;
    }
    const account = deps.telegram.redeemLoginCode(parsed.data.recoveryCode);
    if (!account) {
      send(res, 401, { code: 'unauthorized', message: 'invalid or expired code' });
      return;
    }
    const [accessToken, refreshToken] = await Promise.all([
      deps.auth.signAccess(account.accountId, account.displayName),
      deps.auth.signRefresh(account.accountId, account.displayName),
    ]);
    deps.logger.info('telegram login', { accountId: account.accountId });
    send(res, 200, {
      accountId: account.accountId,
      displayName: account.displayName,
      accessToken,
      refreshToken,
    });
    return;
  }

  // --- Achievements ---------------------------------------------------------------------------
  // Grant (idempotently) an achievement for a game to the caller's own account. Trust model: the
  // caller's access token is the only authorization — see docs/ARCHITECTURE.md.
  if (method === 'POST' && url === '/auth/achievements') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = grantAchievementRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid achievement grant' });
      return;
    }
    const result = deps.accounts.grantAchievement(claims.sub, parsed.data.gameId, parsed.data.achievementId);
    if (!result) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    if (result.granted) deps.logger.info('achievement granted', { accountId: claims.sub, ...parsed.data });
    send(res, 200, result);
    return;
  }

  // The caller's own unlocked achievements, across every game.
  if (method === 'GET' && url === '/auth/achievements') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const account = deps.accounts.get(claims.sub);
    send(res, 200, { achievements: account?.achievements ?? [] });
    return;
  }

  // --- Profile: avatar/wallpaper/title, persisted on the account -----------------------------
  // No object storage exists yet, so images are stored as data URLs directly on the account row
  // (see docs/ARCHITECTURE.md) — the 200KB default readJson cap doesn't apply to these two routes.
  if (method === 'PUT' && url === '/auth/profile/avatar') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = setAvatarRequest.safeParse(await readJson(req, 4_000_000));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid avatar' });
      return;
    }
    const account = deps.accounts.setAvatar(claims.sub, parsed.data.dataUrl);
    if (!account) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    send(res, 200, { avatarIcon: account.avatarIcon ?? null });
    return;
  }

  if (method === 'PUT' && url === '/auth/profile/wallpaper') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = setWallpaperRequest.safeParse(await readJson(req, 4_000_000));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid wallpaper' });
      return;
    }
    const account = deps.accounts.setWallpaper(claims.sub, parsed.data.dataUrl);
    if (!account) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    send(res, 200, { wallpaper: account.wallpaper ?? null });
    return;
  }

  // Sets the "title" badge shown across every game. Must reference one of the account's OWN
  // unlocked achievements (or null to clear) — real validation, unlike achievement granting itself.
  if (method === 'PUT' && url === '/auth/profile/title') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = setTitleRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid title' });
      return;
    }
    const ref = parsed.data.titleAchievement;
    if (ref) {
      const account = deps.accounts.get(claims.sub);
      const owned = account?.achievements.some(
        (a) => a.gameId === ref.gameId && a.achievementId === ref.achievementId,
      );
      if (!owned) {
        send(res, 400, { code: 'validation', message: 'achievement not unlocked' });
        return;
      }
    }
    const account = deps.accounts.setTitleAchievement(claims.sub, ref);
    if (!account) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    send(res, 200, { titleAchievement: account.titleAchievement });
    return;
  }

  // Games favorited in the library — a small, rarely-mutated list, so a full replace (rather than
  // incremental add/remove) keeps the client/server contract simple.
  if (method === 'PUT' && url === '/auth/profile/favorites') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = setFavoritesRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid favorites' });
      return;
    }
    const account = deps.accounts.setFavorites(claims.sub, parsed.data.gameIds);
    if (!account) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    send(res, 200, { favoriteGameIds: account.favoriteGameIds });
    return;
  }

  // The caller's full profile customization (avatar/wallpaper/title/favorites).
  if (method === 'GET' && url === '/auth/profile') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const account = deps.accounts.get(claims.sub);
    send(res, 200, {
      avatarIcon: account?.avatarIcon ?? null,
      wallpaper: account?.wallpaper ?? null,
      titleAchievement: account?.titleAchievement ?? null,
      favoriteGameIds: account?.favoriteGameIds ?? [],
    });
    return;
  }

  // --- Playtime stats: last-played on launch, seconds accrued via in-game heartbeats -----------
  // Stamp a launch of `gameId` by the caller (sets last_played_at, opens the heartbeat window).
  if (method === 'POST' && url === '/auth/stats/enter') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = recordEnterRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid enter' });
      return;
    }
    const row = deps.stats.recordEnter(claims.sub, parsed.data.gameId);
    send(res, 200, { secondsPlayed: row.secondsPlayed });
    return;
  }

  // Credit clamped elapsed time since the caller's previous heartbeat/enter for `gameId`.
  if (method === 'POST' && url === '/auth/stats/heartbeat') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = heartbeatRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid heartbeat' });
      return;
    }
    const row = deps.stats.heartbeat(claims.sub, parsed.data.gameId);
    send(res, 200, { secondsPlayed: row.secondsPlayed });
    return;
  }

  // The caller's per-game playtime + last-played, across every game.
  if (method === 'GET' && url === '/auth/stats') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const stats = deps.stats
      .statsFor(claims.sub)
      .map((r) => ({ gameId: r.gameId, secondsPlayed: r.secondsPlayed, lastPlayedAt: r.lastPlayedAt }));
    send(res, 200, { stats });
    return;
  }

  // --- Admin: account roster + moderation (apps/admin) ---------------------------------------
  if (method === 'GET' && url === '/auth/admin/admins') {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    send(res, 200, { admins: deps.accounts.listAdmins().map(toAdminSummary) });
    return;
  }

  if (method === 'GET' && (url === '/auth/admin/accounts' || url?.startsWith('/auth/admin/accounts?'))) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const parsedUrl = new URL(url, 'http://localhost');
    const q = parsedUrl.searchParams.get('q') ?? undefined;
    const limit = Math.min(Math.max(Number(parsedUrl.searchParams.get('limit')) || 50, 1), 100);
    const offset = Math.max(Number(parsedUrl.searchParams.get('offset')) || 0, 0);
    const { accounts, total } = deps.accounts.listAccounts({ q, limit, offset });
    send(res, 200, { accounts: accounts.map(toAdminSummary), total });
    return;
  }

  const acctDetailMatch = method === 'GET' && url?.match(/^\/auth\/admin\/accounts\/([^/?]+)\/?$/);
  if (acctDetailMatch) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const account = deps.accounts.get(acctDetailMatch[1]!);
    if (!account) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    const stats = deps.stats
      .statsFor(account.id)
      .map((r) => ({ gameId: r.gameId, secondsPlayed: r.secondsPlayed, lastPlayedAt: r.lastPlayedAt }));
    send(res, 200, {
      id: account.id,
      displayName: account.displayName,
      isAdmin: account.isAdmin,
      telegramLinked: !!account.telegramId,
      avatarIcon: account.avatarIcon ?? null,
      wallpaper: account.wallpaper ?? null,
      titleAchievement: account.titleAchievement,
      achievements: account.achievements,
      favoriteGameIds: account.favoriteGameIds,
      stats,
    });
    return;
  }

  const acctRoleMatch = method === 'PUT' && url?.match(/^\/auth\/admin\/accounts\/([^/?]+)\/role\/?$/);
  if (acctRoleMatch) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const targetId = acctRoleMatch[1]!;
    const parsed = setAdminRoleRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid role' });
      return;
    }
    // Never let the last admin demote themselves (or be demoted) into a state nobody can undo.
    if (!parsed.data.isAdmin) {
      const admins = deps.accounts.listAdmins();
      if (admins.length === 1 && admins[0]!.id === targetId) {
        send(res, 400, { code: 'validation', message: 'cannot demote the last remaining admin' });
        return;
      }
    }
    const account = deps.accounts.setAdmin(targetId, parsed.data.isAdmin);
    if (!account) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    deps.logger.info('admin role changed', { accountId: targetId, isAdmin: parsed.data.isAdmin, by: claims.sub });
    send(res, 200, toAdminSummary(account));
    return;
  }

  // Manual grant on an arbitrary account (support-ticket case: "I should have this achievement") —
  // same validation/store call as the self-service `/auth/achievements` above, just targeting
  // `:id` instead of trusting `claims.sub`.
  const acctAchievementsMatch = method === 'POST' && url?.match(/^\/auth\/admin\/accounts\/([^/?]+)\/achievements\/?$/);
  if (acctAchievementsMatch) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const targetId = acctAchievementsMatch[1]!;
    const parsed = grantAchievementRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid achievement grant' });
      return;
    }
    const result = deps.accounts.grantAchievement(targetId, parsed.data.gameId, parsed.data.achievementId);
    if (!result) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    if (result.granted) {
      deps.logger.info('achievement granted (admin)', { accountId: targetId, by: claims.sub, ...parsed.data });
    }
    send(res, 200, result);
    return;
  }

  // Undo an accidental/mistaken grant. Same body shape as the grant route above.
  const acctAchievementRevokeMatch = method === 'DELETE' && url?.match(/^\/auth\/admin\/accounts\/([^/?]+)\/achievements\/?$/);
  if (acctAchievementRevokeMatch) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const targetId = acctAchievementRevokeMatch[1]!;
    const parsed = grantAchievementRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid achievement reference' });
      return;
    }
    const revoked = deps.accounts.revokeAchievement(targetId, parsed.data.gameId, parsed.data.achievementId);
    if (!revoked) {
      send(res, 404, { code: 'not_found', message: 'account or achievement not found' });
      return;
    }
    deps.logger.info('achievement revoked (admin)', { accountId: targetId, by: claims.sub, ...parsed.data });
    send(res, 200, { revoked: true });
    return;
  }

  // Moderation: clear (never set) an arbitrary account's avatar/wallpaper — the self-service
  // `PUT /auth/profile/avatar|wallpaper` routes only ever act on `claims.sub`.
  const acctAvatarClearMatch = method === 'DELETE' && url?.match(/^\/auth\/admin\/accounts\/([^/?]+)\/avatar\/?$/);
  if (acctAvatarClearMatch) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const account = deps.accounts.setAvatar(acctAvatarClearMatch[1]!, null);
    if (!account) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    deps.logger.info('avatar cleared (admin)', { accountId: account.id, by: claims.sub });
    send(res, 200, { avatarIcon: null });
    return;
  }

  const acctWallpaperClearMatch = method === 'DELETE' && url?.match(/^\/auth\/admin\/accounts\/([^/?]+)\/wallpaper\/?$/);
  if (acctWallpaperClearMatch) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const account = deps.accounts.setWallpaper(acctWallpaperClearMatch[1]!, null);
    if (!account) {
      send(res, 404, { code: 'not_found', message: 'account not found' });
      return;
    }
    deps.logger.info('wallpaper cleared (admin)', { accountId: account.id, by: claims.sub });
    send(res, 200, { wallpaper: null });
    return;
  }

  send(res, 404, { code: 'not_found', message: 'not found' });
}
