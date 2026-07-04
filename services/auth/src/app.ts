import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Clock, Logger } from '@mygame/shared-types';
import { grantAchievementRequest, handoffRequest, loginRequest, refreshRequest, socialLoginRequest } from '@mygame/protocol';
import type { AuthClaims } from '@mygame/protocol';
import type { AuthCore } from '@mygame/auth-core';
import { TokenError } from '@mygame/auth-core';
import type { AccountStore } from './store.js';
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
  readonly telegram?: TelegramLinking | undefined;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
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

export const createApp = (deps: AppDeps): Server =>
  createServer((req, res) => {
    void handle(req, res, deps).catch((err) => {
      deps.logger.error('unhandled', { err: String(err) });
      if (!res.headersSent) send(res, 500, { code: 'internal', message: 'internal error' });
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

  send(res, 404, { code: 'not_found', message: 'not found' });
}
