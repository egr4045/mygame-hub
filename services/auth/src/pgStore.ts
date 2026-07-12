/**
 * Postgres-backed AccountStore. Durable adapter for the in-memory account port: it keeps the
 * canonical account logic in `createMemoryAccountStore` (reads stay synchronous) and mirrors every
 * mutation to Postgres via the WriteQueue. `init()` hydrates memory from the DB on boot, so a
 * restart re-claims the same account ids (stable SSO identity).
 */
import { type Pool, WriteQueue } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import { createMemoryAccountStore, type Account, type AccountStore, type TitleAchievementRef } from './store.js';

export interface PgAccountStore extends AccountStore {
  /** Load all accounts from Postgres into the in-memory working set. Call once before serving. */
  init(): Promise<void>;
  /** Flush every queued write — call on shutdown so no acknowledged mutation misses Postgres. */
  drain(): Promise<void>;
}

export const createPgAccountStore = (pool: Pool, logger: Logger): PgAccountStore => {
  const mem = createMemoryAccountStore();
  const queue = new WriteQueue(logger);

  /** Upsert the account's *current* full state (mem returns live references, so this is always fresh). */
  const persist = (a: Account): void =>
    queue.push('account.upsert', () =>
      pool.query(
        `INSERT INTO accounts (id, display_name, telegram_id, vk_id, avatar_icon, wallpaper, title_achievement, achievements, favorite_game_ids, is_admin, is_banned, password_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, now())
         ON CONFLICT (id) DO UPDATE SET
           display_name       = EXCLUDED.display_name,
           telegram_id         = EXCLUDED.telegram_id,
           vk_id               = EXCLUDED.vk_id,
           avatar_icon         = EXCLUDED.avatar_icon,
           wallpaper           = EXCLUDED.wallpaper,
           title_achievement   = EXCLUDED.title_achievement,
           achievements        = EXCLUDED.achievements,
           favorite_game_ids   = EXCLUDED.favorite_game_ids,
           is_admin            = EXCLUDED.is_admin,
           is_banned           = EXCLUDED.is_banned,
           password_hash       = EXCLUDED.password_hash,
           updated_at          = now()`,
        [
          a.id,
          a.displayName,
          a.telegramId ?? null,
          a.vkId ?? null,
          a.avatarIcon ?? null,
          a.wallpaper ?? null,
          JSON.stringify(a.titleAchievement),
          JSON.stringify(a.achievements),
          JSON.stringify(a.favoriteGameIds),
          a.isAdmin,
          a.isBanned,
          a.passwordHash,
        ],
      ),
    );

  return {
    async init() {
      const { rows } = await pool.query(
        `SELECT id, display_name, telegram_id, vk_id, avatar_icon, wallpaper, title_achievement, achievements, favorite_game_ids, is_admin, is_banned, password_hash FROM accounts`,
      );
      for (const r of rows) {
        const acc = mem.createAccount(r.display_name as string, r.password_hash as string, r.id as string);
        if (r.telegram_id) mem.linkSocial(acc.id, 'telegram', r.telegram_id as string);
        if (r.vk_id) mem.linkSocial(acc.id, 'vk', r.vk_id as string);
        if (r.avatar_icon) mem.setAvatar(acc.id, r.avatar_icon as string);
        if (r.wallpaper) mem.setWallpaper(acc.id, r.wallpaper as string);
        mem.setTitleAchievement(acc.id, (r.title_achievement as TitleAchievementRef | null) ?? null);
        mem.hydrateAchievements(acc.id, (r.achievements as Account['achievements'] | null) ?? []);
        mem.setFavorites(acc.id, (r.favorite_game_ids as string[] | null) ?? []);
        mem.setAdmin(acc.id, r.is_admin === true);
        mem.setBanned(acc.id, r.is_banned === true);
      }
      logger.info('accounts hydrated', { count: rows.length });
    },

    createAccount(displayName, passwordHash) {
      const a = mem.createAccount(displayName, passwordHash);
      persist(a);
      return a;
    },
    findByDisplayName: (name) => mem.findByDisplayName(name),
    get: (id) => mem.get(id),
    findBySocial: (network, socialId) => mem.findBySocial(network, socialId),
    linkSocial(id, network, socialId) {
      const a = mem.linkSocial(id, network, socialId);
      if (a) persist(a);
      return a;
    },
    grantAchievement(id, gameId, achievementId) {
      const result = mem.grantAchievement(id, gameId, achievementId);
      if (result?.granted) {
        const a = mem.get(id);
        if (a) persist(a);
      }
      return result;
    },
    hydrateAchievements: (id, achievements) => mem.hydrateAchievements(id, achievements),
    revokeAchievement(id, gameId, achievementId) {
      const revoked = mem.revokeAchievement(id, gameId, achievementId);
      if (revoked) {
        const a = mem.get(id);
        if (a) persist(a);
      }
      return revoked;
    },
    setAvatar(id, dataUrl) {
      const a = mem.setAvatar(id, dataUrl);
      if (a) persist(a);
      return a;
    },
    setWallpaper(id, dataUrl) {
      const a = mem.setWallpaper(id, dataUrl);
      if (a) persist(a);
      return a;
    },
    setTitleAchievement(id, ref) {
      const a = mem.setTitleAchievement(id, ref);
      if (a) persist(a);
      return a;
    },
    setFavorites(id, gameIds) {
      const a = mem.setFavorites(id, gameIds);
      if (a) persist(a);
      return a;
    },
    setPasswordHash(id, passwordHash) {
      const a = mem.setPasswordHash(id, passwordHash);
      if (a) persist(a);
      return a;
    },
    setDisplayName(id, name) {
      const result = mem.setDisplayName(id, name);
      if (result.account) persist(result.account);
      return result;
    },
    setAdmin(id, isAdmin) {
      const a = mem.setAdmin(id, isAdmin);
      if (a) persist(a);
      return a;
    },
    setBanned(id, isBanned) {
      const a = mem.setBanned(id, isBanned);
      if (a) persist(a);
      return a;
    },
    listAccounts: (opts) => mem.listAccounts(opts),
    listAdmins: () => mem.listAdmins(),
    drain: () => queue.drain(),
  };
};
