import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Clock, Logger } from '@mygame/shared-types';
import { handoffRequest, loginRequest, refreshRequest } from '@mygame/protocol';
import type { AuthCore } from '@mygame/auth-core';
import { TokenError } from '@mygame/auth-core';
import type { AccountStore } from './store.js';

/**
 * Auth HTTP app. Two routes: passwordless dev login (claim a display name → account + JWTs) and
 * token refresh. Dependencies are injected as ports so the same app runs with real or fake
 * adapters (the isolation contract).
 */
export interface AppDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly auth: AuthCore;
  readonly accounts: AccountStore;
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

  send(res, 404, { code: 'not_found', message: 'not found' });
}
