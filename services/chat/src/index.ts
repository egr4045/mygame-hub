/**
 * Production entry: real adapters (console logger, chat store). The store is Postgres-backed when
 * `DATABASE_URL` is set (durable message history, survives restart) and falls back to in-memory
 * otherwise — with a loud warning, since that loses every message on restart.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createPool, runMigrations } from '@mygame/platform-db';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createChatServer } from './server.js';
import { createMemoryChatStore, type ChatStore } from './store.js';
import { createPgChatStore } from './pgStore.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});

const store: ChatStore = await (async () => {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — messages are in-memory and will not survive a restart');
    return createMemoryChatStore();
  }
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const pgStore = createPgChatStore(pool, logger);
  await pgStore.init();
  logger.info('messages persisted to postgres');
  return pgStore;
})();

const { httpServer } = createChatServer({ auth, store, logger, corsOrigin: config.corsOrigin });

httpServer.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
