/**
 * Production entry: real adapters (system clock, console logger, community store). The store is
 * Postgres-backed when `DATABASE_URL` is set (durable changelog/discussions, survives restart) and
 * falls back to in-memory otherwise — with a loud warning, since that loses content on restart.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createPool, runMigrations } from '@mygame/platform-db';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createMemoryCommunityStore, type CommunityStore } from './store.js';
import { createPgCommunityStore } from './pgStore.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});

const store: CommunityStore = await (async () => {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — changelog/discussions are in-memory and will not survive a restart');
    return createMemoryCommunityStore();
  }
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const pgStore = createPgCommunityStore(pool, logger);
  await pgStore.init();
  logger.info('community content persisted to postgres');
  return pgStore;
})();

if (config.adminIds.length === 0) {
  logger.warn('COMMUNITY_ADMIN_IDS not set — no account can publish changelog entries');
}

const app = createApp({ clock: { now: () => Date.now() }, logger, auth, store, adminIds: config.adminIds });

app.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
