/**
 * Production entry: real adapters (system clock, console logger, account store). The account store is
 * Postgres-backed when `DATABASE_URL` is set (durable identity, survives restart) and falls back to
 * in-memory otherwise — with a loud warning, since that loses every account on restart.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createPool, runMigrations, type Pool } from '@mygame/platform-db';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createMemoryAccountStore, type AccountStore } from './store.js';
import { createPgAccountStore } from './pgStore.js';
import { createMemoryGameStatsStore, type GameStatsStore } from './statsStore.js';
import { createPgGameStatsStore } from './pgStatsStore.js';
import { createMemoryCatalogStore, type CatalogStore } from './catalogStore.js';
import { createPgCatalogStore } from './pgCatalogStore.js';
import { createTelegramClient } from '@mygame/telegram';
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

let pool: Pool | undefined;
const { accounts, stats, catalog } = await (async (): Promise<{
  accounts: AccountStore;
  stats: GameStatsStore;
  catalog: CatalogStore;
}> => {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — accounts + playtime are in-memory and will not survive a restart');
    return { accounts: createMemoryAccountStore(), stats: createMemoryGameStatsStore(), catalog: createMemoryCatalogStore() };
  }
  pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const accountStore = createPgAccountStore(pool, logger);
  await accountStore.init();
  const statsStore = createPgGameStatsStore(pool, logger);
  await statsStore.init();
  const catalogStore = createPgCatalogStore(pool, logger);
  await catalogStore.init();
  logger.info('accounts + playtime persisted to postgres');
  return { accounts: accountStore, stats: statsStore, catalog: catalogStore };
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

/** The disk-monitor bot (chat service) shares this single token, and only one consumer may poll a
 *  given token — so auth owns polling and chat only *sends*. `admin` (from anyone) registers that
 *  chat as the ops-alert recipient (persisted in the shared ops_alert_recipient table). */
const handleOpsAdmin = async (client: ReturnType<typeof createTelegramClient>, chatId: string): Promise<void> => {
  if (!pool) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ops_alert_recipient (
         singleton BOOLEAN PRIMARY KEY DEFAULT true, chat_id TEXT NOT NULL, registered_at BIGINT NOT NULL)`,
    );
    const existing = await pool.query(`SELECT chat_id FROM ops_alert_recipient WHERE singleton = true`);
    if (!existing.rows[0]) {
      await pool.query(
        `INSERT INTO ops_alert_recipient (singleton, chat_id, registered_at) VALUES (true, $1, $2)
         ON CONFLICT (singleton) DO NOTHING`,
        [chatId, Date.now()],
      );
      logger.info('ops alert recipient registered', { chatId });
      await client.sendMessage(chatId, '✅ Готово. Теперь вы получаете алерты о состоянии сервера (место на диске и т.п.).');
    } else if (existing.rows[0].chat_id === chatId) {
      await client.sendMessage(chatId, 'Вы уже назначены получателем алертов.');
    } else {
      await client.sendMessage(chatId, 'Получатель алертов уже назначен другим пользователем.');
    }
  } catch (err) {
    logger.error('ops admin register failed', { err: String(err) });
  }
};

let telegram: TelegramLinking | undefined;
if (config.telegramBotToken) {
  const client = createTelegramClient(config.telegramBotToken, logger);
  const me = await client.getMe();
  telegram = createTelegramLinking({ accounts, client, logger, botUsername: me?.username ?? null });
  client.startPolling(async (m) => {
    if (m.text.trim().toLowerCase().replace(/^\//, '') === 'admin') {
      await handleOpsAdmin(client, m.chatId);
      return;
    }
    await telegram!.handleMessage(m);
  });
  logger.info('telegram bot enabled (account linking + ops alerts)', { bot: me?.username ?? '(unknown)' });
} else {
  logger.info('TELEGRAM_BOT_TOKEN not set — telegram linking disabled');
}

const app = createApp({ clock: { now: () => Date.now() }, logger, auth, accounts, stats, catalog, telegram });

app.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));

// Write-behind persistence: flush queued account/playtime writes before exiting so a deploy can't
// drop an acknowledged mutation. Hard-exit fallback in case the pool is wedged.
const shutdown = (signal: string): void => {
  logger.info('shutting down', { signal });
  setTimeout(() => process.exit(1), 10_000).unref();
  void (async () => {
    try {
      app.close();
      await (accounts as Partial<import('./pgStore.js').PgAccountStore>).drain?.();
      await (stats as Partial<import('./pgStatsStore.js').PgGameStatsStore>).drain?.();
      await (catalog as Partial<import('./pgCatalogStore.js').PgCatalogStore>).drain?.();
    } finally {
      process.exit(0);
    }
  })();
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
