/**
 * @mygame/telegram — a minimal Telegram Bot API client over global fetch (no SDK dependency).
 *
 * Uses **long polling** (`getUpdates`) so it needs no public webhook — it works in dev and behind a
 * firewall. Only one consumer may poll a given bot token at a time, so run a single instance per
 * token (different bots/tokens are fully independent — e.g. auth's linking bot and chat's ops-alert
 * bot coexist without conflict).
 *
 * The token is a secret: it only ever appears in the request URL built here, never in logs.
 */
import type { Logger } from '@mygame/shared-types';

export interface TelegramMessage {
  chatId: string;
  text: string;
  firstName?: string;
  username?: string;
}

export interface TelegramClient {
  /** Bot identity (for building `t.me/<username>?start=` deep links). Null on failure. */
  getMe(): Promise<{ username: string } | null>;
  sendMessage(chatId: string, text: string): Promise<void>;
  /** Start the long-poll loop; returns a stop function. */
  startPolling(onMessage: (m: TelegramMessage) => void | Promise<void>): () => void;
}

interface TgEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}
interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number };
    from?: { first_name?: string; username?: string };
  };
}

export const createTelegramClient = (token: string, logger: Logger): TelegramClient => {
  const call = async <T>(method: string, body?: unknown): Promise<T> => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json()) as TgEnvelope<T>;
    if (!data.ok || data.result === undefined) {
      throw new Error(`telegram ${method} failed: ${data.description ?? res.status}`);
    }
    return data.result;
  };

  return {
    async getMe() {
      try {
        const me = await call<{ username?: string }>('getMe');
        return { username: String(me.username ?? '') };
      } catch (err) {
        logger.error('telegram getMe failed', { err: String(err) });
        return null;
      }
    },

    async sendMessage(chatId, text) {
      try {
        await call('sendMessage', { chat_id: chatId, text });
      } catch (err) {
        logger.error('telegram sendMessage failed', { err: String(err) });
      }
    },

    startPolling(onMessage) {
      let stopped = false;
      let offset = 0;

      const loop = async (): Promise<void> => {
        while (!stopped) {
          try {
            const updates = await call<TgUpdate[]>('getUpdates', {
              offset,
              timeout: 30,
              allowed_updates: ['message'],
            });
            for (const u of updates) {
              offset = u.update_id + 1;
              const msg = u.message;
              if (!msg || typeof msg.text !== 'string') continue;
              await onMessage({
                chatId: String(msg.chat.id),
                text: msg.text,
                ...(msg.from?.first_name !== undefined ? { firstName: msg.from.first_name } : {}),
                ...(msg.from?.username !== undefined ? { username: msg.from.username } : {}),
              });
            }
          } catch (err) {
            if (stopped) break;
            logger.warn('telegram getUpdates error, retrying', { err: String(err) });
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      };

      void loop();
      logger.info('telegram polling started');
      return () => {
        stopped = true;
      };
    },
  };
};
