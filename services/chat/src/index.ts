/**
 * Production entry: real adapters (console logger, chat store). The store is Postgres-backed when
 * `DATABASE_URL` is set (durable message history, survives restart) and falls back to in-memory
 * otherwise — with a loud warning, since that loses every message on restart.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createPool, runMigrations, type Pool } from '@mygame/platform-db';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createChatServer } from './server.js';
import { createMemoryChatStore, type ChatStore } from './store.js';
import { createPgChatStore, type PgChatStore } from './pgStore.js';
import { createOpsMonitor } from './ops.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});

let pool: Pool | undefined;
const store: ChatStore | PgChatStore = await (async () => {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — messages are in-memory and will not survive a restart');
    return createMemoryChatStore();
  }
  pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const pgStore = createPgChatStore(pool, logger);
  await pgStore.init();
  logger.info('messages persisted to postgres');
  return pgStore;
})();

const maybePg = store as Partial<PgChatStore>;

const { httpServer, io } = createChatServer({
  auth,
  store,
  logger,
  corsOrigin: config.corsOrigin,
  livekit: { url: config.livekitUrl, apiKey: config.livekitApiKey, apiSecret: config.livekitApiSecret },
  dataDir: config.dataDir,
  uploadMaxBytes: config.uploadMaxBytes,
  retentionDays: config.retentionDays,
  ...(maybePg.isAccountBanned ? { isAccountBanned: maybePg.isAccountBanned.bind(store) } : {}),
});

// Platform-ops: disk-space alerting + the ops-alert Telegram bot (separate token). No-op without a token.
const stopOps = createOpsMonitor({
  logger,
  dataDir: config.dataDir,
  botToken: config.opsBotToken,
  pool,
  diskAlertPct: config.diskAlertPct,
  diskAlertMinBytes: config.diskAlertMinBytes,
  diskCheckMs: config.diskCheckMs,
});

httpServer.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));

// Write-behind persistence means an ack'd message may still be queued for Postgres — flush before
// exiting so a deploy/restart can't silently drop it. The unref'd timer hard-exits if the pool is
// wedged rather than hanging the deploy forever.
const shutdown = (signal: string): void => {
  logger.info('shutting down', { signal });
  setTimeout(() => process.exit(1), 10_000).unref();
  void (async () => {
    try {
      stopOps();
      io.close();
      httpServer.close();
      await maybePg.drain?.();
    } finally {
      process.exit(0);
    }
  })();
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
