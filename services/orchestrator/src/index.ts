/** Production entry: real Docker + HTTP adapters, periodic reaper. */
import { createAuthCore } from '@mygame/auth-core';
import { createPool, type Pool } from '@mygame/platform-db';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { dockerRuntime } from './docker.js';
import { httpProbe } from './probe.js';
import { Orchestrator } from './orchestrator.js';
import { createAdminCheck } from './adminCheck.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });

const orch = new Orchestrator(config.games, {
  runtime: dockerRuntime,
  probe: httpProbe,
  clock: { now: () => Date.now() },
  logger,
});
orch.startReaper(config.reaperMs);

const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});

// Read-only: checks the shared accounts.is_admin flag for the force-stop route. This service never
// writes through this pool, and runs no migrations of its own (auth already owns that table).
let pool: Pool | undefined;
if (config.databaseUrl) {
  pool = createPool(config.databaseUrl);
} else {
  logger.warn('DATABASE_URL not set — admin force-stop route is unreachable (501), see adminCheck.ts');
}

createApp({ orch, logger, auth, isAdmin: pool ? createAdminCheck(pool) : undefined }).listen(config.port, () =>
  logger.info('listening', { port: config.port, games: config.games.map((g) => g.id), reaperMs: config.reaperMs }),
);
