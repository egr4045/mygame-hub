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
import { createTelegramClient } from '@mygame/telegram';
import type { Suggestion } from '@mygame/protocol';

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

// New-suggestion Telegram ping (send-only — auth owns the single poller of this token). Pings the
// registered ops recipient (whoever DM'd the bot `admin`) with the idea + a deep link into apps/admin.
const notifySuggestion = ((): ((s: Suggestion) => void) | undefined => {
  if (!config.opsAlertBotToken) {
    logger.info('OPS_ALERT_BOT_TOKEN not set — new-suggestion Telegram alerts disabled');
    return undefined;
  }
  const bot = createTelegramClient(config.opsAlertBotToken, logger);
  const link = `${config.publicBaseUrl.replace(/\/$/, '')}/admin/#suggestions`;
  return (s: Suggestion): void => {
    void (async () => {
      if (!pool) return;
      try {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS ops_alert_recipient (
             singleton BOOLEAN PRIMARY KEY DEFAULT true, chat_id TEXT NOT NULL, registered_at BIGINT NOT NULL)`,
        );
        const r = await pool.query(`SELECT chat_id FROM ops_alert_recipient WHERE singleton = true`);
        const chatId = r.rows[0]?.chat_id as string | undefined;
        if (!chatId) return;
        const preview = s.body.length > 600 ? `${s.body.slice(0, 600)}…` : s.body;
        await bot.sendMessage(chatId, `💡 Новое предложение от ${s.authorName}:\n\n${preview}\n\nОткрыть в админке: ${link}`);
      } catch (err) {
        logger.error('suggestion notify failed', { err: String(err) });
      }
    })();
  };
})();

const app = createApp({ clock: { now: () => Date.now() }, logger, auth, store, isAdmin: createAdminCheck(pool), notifySuggestion });

app.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
