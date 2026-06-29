/**
 * Production entry: real adapters (system clock, console logger, account store). The account store is
 * Postgres-backed when `DATABASE_URL` is set (durable identity, survives restart) and falls back to
 * in-memory otherwise — with a loud warning, since that loses every account on restart.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createPool, runMigrations } from '@mygame/platform-db';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createMemoryAccountStore, type AccountStore } from './store.js';
import { createPgAccountStore } from './pgStore.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: config.accessTtl,
  refreshTtl: config.refreshTtl,
  handoffTtl: config.handoffTtl,
});

const accounts: AccountStore = await (async () => {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — accounts are in-memory and will not survive a restart');
    return createMemoryAccountStore();
  }
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const store = createPgAccountStore(pool, logger);
  await store.init();
  logger.info('accounts persisted to postgres');
  return store;
})();

const app = createApp({ clock: { now: () => Date.now() }, logger, auth, accounts });

app.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
