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

const maybePg = store as Partial<import('./pgStore.js').PgSocialStore>;

const { httpServer } = createSocialServer({
  auth,
  store,
  invites,
  logger,
  corsOrigin: config.corsOrigin,
  ...(maybePg.isAccountBanned ? { isAccountBanned: maybePg.isAccountBanned.bind(store) } : {}),
});

httpServer.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));

// Write-behind persistence: flush queued friend/invite writes before exiting so a deploy can't drop
// an acknowledged mutation. Hard-exit fallback in case the pool is wedged.
const shutdown = (signal: string): void => {
  logger.info('shutting down', { signal });
  setTimeout(() => process.exit(1), 10_000).unref();
  void (async () => {
    try {
      httpServer.close();
      await maybePg.drain?.();
      await (invites as Partial<import('./pgInvites.js').PgInviteStore>).drain?.();
    } finally {
      process.exit(0);
    }
  })();
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
