import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '@mygame/shared-types';
import type { AuthClaims } from '@mygame/protocol';
import type { AuthCore } from '@mygame/auth-core';
import type { Orchestrator } from './orchestrator.js';

const cors = (res: ServerResponse): void => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
};

const json = (res: ServerResponse, code: number, body: unknown): void => {
  cors(res);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const bearer = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
};

export interface AppDeps {
  readonly orch: Orchestrator;
  readonly logger: Logger;
  readonly auth: AuthCore;
  /** Checks the caller's `is_admin` flag on the shared `accounts` table (see `adminCheck.ts`).
   *  `undefined` when no Postgres is configured — the one route gated by this 501s in that case
   *  rather than allowing an unauthenticated force-stop or hard-crashing on a missing dependency. */
  readonly isAdmin: ((accountId: string) => Promise<boolean>) | undefined;
}

/** Verify the caller's access token; on failure it writes a 401 and returns null. */
const requireAdmin = async (req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<AuthClaims | null> => {
  if (!deps.isAdmin) {
    json(res, 501, { error: 'admin routes not configured (DATABASE_URL unset)' });
    return null;
  }
  const token = bearer(req);
  if (!token) {
    json(res, 401, { error: 'missing access token' });
    return null;
  }
  let claims: AuthClaims;
  try {
    claims = await deps.auth.verify(token);
    if (claims.typ !== 'access') {
      json(res, 401, { error: 'not an access token' });
      return null;
    }
  } catch {
    json(res, 401, { error: 'invalid access token' });
    return null;
  }
  if (!(await deps.isAdmin(claims.sub))) {
    json(res, 403, { error: 'admin access required' });
    return null;
  }
  return claims;
};

/**
 * Orchestrator HTTP API: the launcher lists games and "enters" one (which wakes it on demand,
 * public, no auth — same as ever). apps/admin can additionally force-stop a game, gated by the
 * platform's shared `is_admin` flag.
 *   GET  /games               -> { games: [{ id, name, status, players }] }
 *   POST /games/:id/enter     -> ensures the game is running -> { ready: true }
 *   POST /games/:id/stop      -> admin-only force-stop -> { stopped: true }
 */
export const createApp = (deps: AppDeps): Server =>
  createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        cors(res);
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      try {
        if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' });
        if (req.method === 'GET' && url.pathname === '/games')
          return json(res, 200, { games: await deps.orch.list() });

        const enterMatch = url.pathname.match(/^\/games\/([^/]+)\/enter$/);
        if (req.method === 'POST' && enterMatch) {
          const id = enterMatch[1];
          if (!id || !deps.orch.has(id)) return json(res, 404, { error: 'unknown game' });
          await deps.orch.ensureUp(id);
          return json(res, 200, { ready: true });
        }

        const stopMatch = url.pathname.match(/^\/games\/([^/]+)\/stop$/);
        if (req.method === 'POST' && stopMatch) {
          const claims = await requireAdmin(req, res, deps);
          if (!claims) return;
          const id = stopMatch[1];
          if (!id || !deps.orch.has(id)) return json(res, 404, { error: 'unknown game' });
          await deps.orch.forceDown(id);
          deps.logger.info('game force-stopped (admin)', { game: id, by: claims.sub });
          return json(res, 200, { stopped: true });
        }

        json(res, 404, { error: 'not_found' });
      } catch (e) {
        deps.logger.error('request error', { err: String(e) });
        json(res, 500, { error: 'internal' });
      }
    })();
  });
