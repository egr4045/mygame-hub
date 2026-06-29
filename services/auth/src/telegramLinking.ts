/**
 * Telegram account linking & login — the real bot logic (replaces the old botGateway stub).
 *
 * Link flow: the hub (authenticated) asks for a one-time **link code** bound to the account; the user
 * opens the bot via the deep link, the bot receives `/start <code>` and binds their Telegram chat id
 * to the account (`accounts.telegram_id`, persisted).
 *
 * Login flow: on another device the user sends `/login` to the bot, which mints a one-time **login
 * code**; entering it on the auth screen exchanges it for a session (`POST /auth/social/login`).
 *
 * Codes are short-lived (5 min) and kept in memory — if auth restarts mid-link the user just retries.
 */
import { randomBytes } from 'node:crypto';
import type { Logger } from '@mygame/shared-types';
import type { AccountStore } from './store.js';
import type { TelegramClient, TelegramMessage } from './telegram.js';

const CODE_TTL_MS = 5 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const makeCode = (len = 6): string => {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! & 31];
  return out;
};

interface Pending {
  accountId: string;
  expiresAt: number;
}

export interface TelegramLinking {
  /** Mint a code bound to `accountId`; the bot consumes it via `/start <code>`. */
  createLinkCode(accountId: string): { code: string; url: string };
  /** Whether this account has a linked Telegram (and which chat id). */
  statusFor(accountId: string): { linked: boolean; telegramId?: string };
  /** Redeem a `/login` code typed on the auth screen → the account to log in (or null). */
  redeemLoginCode(code: string): { accountId: string; displayName: string } | null;
  /** Handle an incoming bot message (from the long-poll loop). */
  handleMessage(m: TelegramMessage): Promise<void>;
}

export interface TelegramLinkingDeps {
  accounts: AccountStore;
  client: TelegramClient;
  logger: Logger;
  /** Bot username for deep links (from getMe). Null → `url` comes back empty. */
  botUsername: string | null;
  now?: () => number;
}

export const createTelegramLinking = (deps: TelegramLinkingDeps): TelegramLinking => {
  const now = deps.now ?? (() => Date.now());
  const linkCodes = new Map<string, Pending>();
  const loginCodes = new Map<string, Pending>();

  const takeFresh = (m: Map<string, Pending>, code: string): Pending | undefined => {
    const p = m.get(code);
    if (!p) return undefined;
    if (p.expiresAt <= now()) {
      m.delete(code);
      return undefined;
    }
    return p;
  };

  const mint = (m: Map<string, Pending>, accountId: string): string => {
    let code = makeCode();
    while (m.has(code)) code = makeCode();
    m.set(code, { accountId, expiresAt: now() + CODE_TTL_MS });
    return code;
  };

  return {
    createLinkCode(accountId) {
      const code = mint(linkCodes, accountId);
      const url = deps.botUsername ? `https://t.me/${deps.botUsername}?start=${code}` : '';
      return { code, url };
    },

    statusFor(accountId) {
      const acc = deps.accounts.get(accountId);
      return acc?.telegramId ? { linked: true, telegramId: acc.telegramId } : { linked: false };
    },

    redeemLoginCode(code) {
      const norm = code.trim().toUpperCase();
      const p = takeFresh(loginCodes, norm);
      if (!p) return null;
      loginCodes.delete(norm);
      const acc = deps.accounts.get(p.accountId);
      return acc ? { accountId: acc.id, displayName: acc.displayName } : null;
    },

    async handleMessage(m) {
      const text = m.text.trim();
      const reply = (t: string): Promise<void> => deps.client.sendMessage(m.chatId, t);

      if (text.startsWith('/start')) {
        const code = text.slice('/start'.length).trim().toUpperCase();
        if (!code) {
          await reply(
            'Привет! Это бот платформы. Нажми «Привязать Telegram» в профиле хаба, чтобы связать аккаунт. ' +
              'Чтобы войти на этом устройстве — отправь /login.',
          );
          return;
        }
        const pending = takeFresh(linkCodes, code);
        if (!pending) {
          await reply('Код привязки неверный или истёк. Сгенерируй новый в профиле хаба.');
          return;
        }
        const existing = deps.accounts.findBySocial('telegram', m.chatId);
        if (existing && existing.id !== pending.accountId) {
          await reply('Этот Telegram уже привязан к другому аккаунту.');
          return;
        }
        linkCodes.delete(code);
        const acc = deps.accounts.linkSocial(pending.accountId, 'telegram', m.chatId);
        if (!acc) {
          await reply('Аккаунт не найден. Попробуй ещё раз.');
          return;
        }
        deps.logger.info('telegram linked', { accountId: acc.id });
        await reply(
          `✅ Telegram привязан к аккаунту «${acc.displayName}». ` +
            'Теперь можно входить с любого устройства командой /login.',
        );
        return;
      }

      if (text.startsWith('/login') || text.startsWith('/recover')) {
        const acc = deps.accounts.findBySocial('telegram', m.chatId);
        if (!acc) {
          await reply('Сначала привяжи аккаунт: нажми «Привязать Telegram» в профиле хаба.');
          return;
        }
        const code = mint(loginCodes, acc.id);
        deps.logger.info('telegram login code issued', { accountId: acc.id });
        await reply(`Код для входа: ${code}\nВведи его на экране входа в хаб (действует 5 минут).`);
        return;
      }

      await reply('Команды: /login — получить код для входа. Привязать аккаунт можно в профиле хаба.');
    },
  };
};
