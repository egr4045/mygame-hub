/**
 * Production entry: real adapters (system clock, console logger, community store). The store is
 * Postgres-backed when `DATABASE_URL` is set (durable changelog/discussions, survives restart) and
 * falls back to in-memory otherwise — with a loud warning, since that loses content on restart.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createPool, runMigrations, type Pool } from '@mygame/platform-db';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createMemoryCommunityStore, type CommunityStore } from './store.js';
import { createPgCommunityStore } from './pgStore.js';
import { createAdminCheck } from './adminCheck.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});

// Also used by createAdminCheck below to read the shared accounts table's is_admin flag — community
// never writes through this pool, only reads it.
let pool: Pool | undefined;

const store: CommunityStore = await (async () => {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — changelog/discussions are in-memory and will not survive a restart');
    logger.warn('no Postgres — admin-gated routes (changelog publish) are unreachable, see adminCheck.ts');
    return createMemoryCommunityStore();
  }
  pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const pgStore = createPgCommunityStore(pool, logger);
  await pgStore.init();
  logger.info('community content persisted to postgres');
  return pgStore;
})();

const app = createApp({ clock: { now: () => Date.now() }, logger, auth, store, isAdmin: createAdminCheck(pool) });

app.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
