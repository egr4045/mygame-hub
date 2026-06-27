import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '@mygame/shared-types';
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

/**
 * Orchestrator HTTP API: the launcher lists games and "enters" one (which wakes it on demand).
 *   GET  /games               -> { games: [{ id, name, status, players }] }
 *   POST /games/:id/enter     -> ensures the game is running -> { ready: true }
 */
export const createApp = (orch: Orchestrator, logger: Logger): Server =>
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
          return json(res, 200, { games: await orch.list() });

        const m = url.pathname.match(/^\/games\/([^/]+)\/enter$/);
        if (req.method === 'POST' && m) {
          const id = m[1];
          if (!id || !orch.has(id)) return json(res, 404, { error: 'unknown game' });
          await orch.ensureUp(id);
          return json(res, 200, { ready: true });
        }
        json(res, 404, { error: 'not_found' });
      } catch (e) {
        logger.error('request error', { err: String(e) });
        json(res, 500, { error: 'internal' });
      }
    })();
  });
