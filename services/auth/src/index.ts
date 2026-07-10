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
import { createMemoryGameStatsStore, type GameStatsStore } from './statsStore.js';
import { createPgGameStatsStore } from './pgStatsStore.js';
import { createTelegramClient } from './telegram.js';
import { createTelegramLinking, type TelegramLinking } from './telegramLinking.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: config.accessTtl,
  refreshTtl: config.refreshTtl,
  handoffTtl: config.handoffTtl,
});

const { accounts, stats } = await (async (): Promise<{ accounts: AccountStore; stats: GameStatsStore }> => {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — accounts + playtime are in-memory and will not survive a restart');
    return { accounts: createMemoryAccountStore(), stats: createMemoryGameStatsStore() };
  }
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const accountStore = createPgAccountStore(pool, logger);
  await accountStore.init();
  const statsStore = createPgGameStatsStore(pool, logger);
  await statsStore.init();
  logger.info('accounts + playtime persisted to postgres');
  return { accounts: accountStore, stats: statsStore };
})();

// One-time admin bootstrap: promotes each configured accountId if the account already exists (log in
// once first, then restart with the id set — same flow COMMUNITY_ADMIN_IDS used to require). Idempotent
// across every subsequent boot. Every admin after this one is managed via apps/admin itself.
for (const id of config.bootstrapAdminIds) {
  const acc = accounts.get(id);
  if (!acc) {
    logger.warn('AUTH_BOOTSTRAP_ADMIN_IDS: account not found — log in once first, then restart', { accountId: id });
    continue;
  }
  if (!acc.isAdmin) {
    accounts.setAdmin(id, true);
    logger.info('bootstrapped admin', { accountId: id });
  }
}

let telegram: TelegramLinking | undefined;
if (config.telegramBotToken) {
  const client = createTelegramClient(config.telegramBotToken, logger);
  const me = await client.getMe();
  telegram = createTelegramLinking({ accounts, client, logger, botUsername: me?.username ?? null });
  client.startPolling((m) => telegram!.handleMessage(m));
  logger.info('telegram linking enabled', { bot: me?.username ?? '(unknown)' });
} else {
  logger.info('TELEGRAM_BOT_TOKEN not set — telegram linking disabled');
}

const app = createApp({ clock: { now: () => Date.now() }, logger, auth, accounts, stats, telegram });

app.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
