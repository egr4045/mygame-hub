/**
 * Platform-ops for the chat service — it lives here because chat owns the disk-heavy upload store
 * and the Postgres pool, so proximity beats a separate always-on process on this RAM-constrained
 * shared host (see the deploy-server notes).
 *
 * Two jobs, both driven by a SEPARATE Telegram bot (its own `OPS_ALERT_BOT_TOKEN`, independent of
 * auth's linking bot):
 *   1. Alert recipient registration: the FIRST person to DM the bot `admin` becomes the recipient
 *      (persisted, so it survives restarts). Later `admin` senders are told it's taken.
 *   2. Disk monitor: samples free space on the upload filesystem and alerts (with hysteresis, so no
 *      flapping) when it drops below a percentage OR an absolute floor.
 */
import { promises as fs } from 'node:fs';
import type { Pool } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import { createTelegramClient } from '@mygame/telegram';

export interface OpsMonitorOptions {
  readonly logger: Logger;
  /** Filesystem to watch (the upload dir's data root). */
  readonly dataDir: string;
  /** Separate ops-alert bot token. Absent → the whole monitor is a no-op. */
  readonly botToken: string | undefined;
  /** Postgres pool for durable recipient persistence. Absent (dev) → recipient kept in memory only. */
  readonly pool?: Pool | undefined;
  /** Alert when free space drops below this fraction (0..1) OR below `diskAlertMinBytes`. */
  readonly diskAlertPct: number;
  readonly diskAlertMinBytes: number;
  readonly diskCheckMs: number;
}

const GB = 1024 * 1024 * 1024;
const fmtGb = (bytes: number): string => `${(bytes / GB).toFixed(1)} ГБ`;

/** Start the ops monitor. Returns a stop function (clears the timer + stops polling). No-op — and a
 *  no-op stop — when no bot token is configured. */
export const createOpsMonitor = (opts: OpsMonitorOptions): (() => void) => {
  const { logger, dataDir, botToken, pool, diskAlertPct, diskAlertMinBytes, diskCheckMs } = opts;
  if (!botToken) {
    logger.info('OPS_ALERT_BOT_TOKEN not set — disk alerting disabled');
    return () => {};
  }

  const bot = createTelegramClient(botToken, logger);
  let recipientChatId: string | null = null;
  let belowThreshold = false; // hysteresis latch

  const loadRecipient = async (): Promise<void> => {
    if (!pool) return;
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ops_alert_recipient (
           singleton BOOLEAN PRIMARY KEY DEFAULT true,
           chat_id TEXT NOT NULL,
           registered_at BIGINT NOT NULL)`,
      );
      const r = await pool.query(`SELECT chat_id FROM ops_alert_recipient WHERE singleton = true`);
      recipientChatId = (r.rows[0]?.chat_id as string | undefined) ?? null;
    } catch (err) {
      logger.error('ops recipient load failed', { err: String(err) });
    }
  };

  const saveRecipient = async (chatId: string): Promise<void> => {
    recipientChatId = chatId;
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO ops_alert_recipient (singleton, chat_id, registered_at) VALUES (true, $1, $2)
         ON CONFLICT (singleton) DO UPDATE SET chat_id = EXCLUDED.chat_id, registered_at = EXCLUDED.registered_at`,
        [chatId, Date.now()],
      );
    } catch (err) {
      logger.error('ops recipient save failed', { err: String(err) });
    }
  };

  // `admin` (with or without a leading slash) registers the first sender as the alert recipient.
  const onMessage = async (m: { chatId: string; text: string }): Promise<void> => {
    if (m.text.trim().toLowerCase().replace(/^\//, '') !== 'admin') return;
    if (recipientChatId === null) {
      await saveRecipient(m.chatId);
      logger.info('ops alert recipient registered', { chatId: m.chatId });
      await bot.sendMessage(
        m.chatId,
        '✅ Готово. Теперь вы получаете алерты о состоянии сервера (место на диске и т.п.).',
      );
    } else if (recipientChatId === m.chatId) {
      await bot.sendMessage(m.chatId, 'Вы уже назначены получателем алертов.');
    } else {
      await bot.sendMessage(m.chatId, 'Получатель алертов уже назначен другим пользователем.');
    }
  };

  const checkDisk = async (): Promise<void> => {
    let free: number;
    let total: number;
    try {
      const s = await fs.statfs(dataDir);
      free = s.bavail * s.bsize;
      total = s.blocks * s.bsize;
    } catch (err) {
      logger.error('disk statfs failed', { dir: dataDir, err: String(err) });
      return;
    }
    const freePct = total > 0 ? free / total : 1;
    const low = freePct < diskAlertPct || free < diskAlertMinBytes;
    // Recover only well clear of the threshold (20% margin) so a value hovering at the line can't
    // spam alert/recovered pairs.
    const recovered = freePct > diskAlertPct * 1.2 && free > diskAlertMinBytes * 1.2;

    if (low && !belowThreshold) {
      belowThreshold = true;
      logger.warn('disk space low', { freeGb: (free / GB).toFixed(1), freePct: (freePct * 100).toFixed(0) });
      if (recipientChatId) {
        await bot.sendMessage(
          recipientChatId,
          `⚠️ Мало места на диске GAMEHUB.\nСвободно: ${fmtGb(free)} из ${fmtGb(total)} (${(freePct * 100).toFixed(0)}%).\nПочистите старые вложения/логи или расширьте диск.`,
        );
      }
    } else if (recovered && belowThreshold) {
      belowThreshold = false;
      if (recipientChatId) {
        await bot.sendMessage(recipientChatId, `✅ Место на диске восстановлено: свободно ${fmtGb(free)} (${(freePct * 100).toFixed(0)}%).`);
      }
    }
  };

  const stopPolling = bot.startPolling(onMessage);
  const timer = setInterval(() => void checkDisk(), diskCheckMs);
  timer.unref?.();
  void (async () => {
    // The upload dir is created lazily on first upload; ensure the watched root exists so the very
    // first statfs (before anyone has uploaded anything) reflects the real filesystem, not ENOENT.
    await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
    await loadRecipient();
    await checkDisk();
  })();
  logger.info('ops monitor started', { dataDir, diskCheckMs, diskAlertPct, diskAlertMinGb: (diskAlertMinBytes / GB).toFixed(1) });

  return () => {
    stopPolling();
    clearInterval(timer);
  };
};
