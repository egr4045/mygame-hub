/**
 * Production entry: real adapters (console logger, social store + invites). Both are Postgres-backed
 * when `DATABASE_URL` is set (durable friends + invites, survive restart) and fall back to in-memory
 * otherwise — with a loud warning, since that loses the whole friend graph on restart.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createPool, runMigrations } from '@mygame/platform-db';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createSocialServer } from './server.js';
import { createMemorySocialStore, type SocialStore } from './store.js';
import { createMemoryInviteStore, type InviteStore } from './invites.js';
import { createPgSocialStore } from './pgStore.js';
import { createPgInviteStore } from './pgInvites.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});

const { store, invites } = await (async (): Promise<{ store: SocialStore; invites: InviteStore }> => {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — friends + invites are in-memory and will not survive a restart');
    return { store: createMemorySocialStore(), invites: createMemoryInviteStore() };
  }
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const pgStore = createPgSocialStore(pool, logger);
  const pgInvites = createPgInviteStore(pool, logger);
  await pgStore.init();
  await pgInvites.init();
  logger.info('friends + invites persisted to postgres');
  return { store: pgStore, invites: pgInvites };
})();

const { httpServer } = createSocialServer({
  auth,
  store,
  invites,
  logger,
  corsOrigin: config.corsOrigin,
});

httpServer.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
