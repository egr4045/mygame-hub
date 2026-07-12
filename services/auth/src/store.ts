import { randomUUID } from 'node:crypto';

/**
 * Account store port. The account is the durable identity sessions bind to. In-memory adapter for
 * standalone/dev; a Postgres adapter swaps in later without touching the service logic.
 */
export interface AccountAchievement {
  gameId: string;
  achievementId: string;
  unlockedAt: number;
}

/** A title badge references one of the account's own achievements; null clears it. */
export type TitleAchievementRef = { gameId: string; achievementId: string } | null;

/** Alphabet for the short friend code — no visually ambiguous chars (0/O, 1/I/L). */
const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const generateFriendCode = (): string => {
  let s = '';
  for (let i = 0; i < 6; i++) s += FRIEND_CODE_ALPHABET[Math.floor(Math.random() * FRIEND_CODE_ALPHABET.length)]!;
  return s;
};

export interface Account {
  id: string;
  displayName: string;
  /** Short, human-dictatable code others use to friend you (e.g. "K7W2PX"). Unique per account. */
  friendCode: string;
  telegramId?: string;
  vkId?: string;
  /** Profile avatar image, as a data URL. */
  avatarIcon?: string;
  /** Profile wallpaper image, as a data URL. */
  wallpaper?: string;
  passwordHash: string;
  titleAchievement: TitleAchievementRef;
  achievements: AccountAchievement[];
  favoriteGameIds: string[];
  /** The platform's one privileged tier (apps/admin) — see docs/ARCHITECTURE.md. */
  isAdmin: boolean;
  isBanned: boolean;
}

export interface AccountStore {
  /** `friendCode` is only supplied during hydration (to preserve the stored code); new accounts
   *  get a freshly generated unique one. */
  createAccount(displayName: string, passwordHash: string, id?: string, friendCode?: string): Account;
  findByDisplayName(name: string): Account | undefined;
  get(id: string): Account | undefined;
  findBySocial(network: 'telegram' | 'vk', socialId: string): Account | undefined;
  linkSocial(id: string, network: 'telegram' | 'vk', socialId: string): Account | undefined;
  /** Idempotent: `granted` is false if the account already had this game's achievement. */
  grantAchievement(
    id: string,
    gameId: string,
    achievementId: string,
  ): { achievement: AccountAchievement; granted: boolean } | undefined;
  /** Bulk-load previously persisted achievements verbatim (timestamps preserved). Hydration only. */
  hydrateAchievements(id: string, achievements: AccountAchievement[]): void;
  /** Admin moderation (apps/admin) — undoes an accidental/mistaken grant. `false` if the account or
   *  that specific achievement isn't found. */
  revokeAchievement(id: string, gameId: string, achievementId: string): boolean;
  /** `null` clears the avatar. */
  setAvatar(id: string, dataUrl: string | null): Account | undefined;
  /** `null` clears the wallpaper. */
  setWallpaper(id: string, dataUrl: string | null): Account | undefined;
  setTitleAchievement(id: string, ref: TitleAchievementRef): Account | undefined;
  /** Full replace, mirroring setWallpaper/setTitleAchievement — the list is small and rarely mutated,
   *  so there's no need for an incremental add/remove API. */
  setFavorites(id: string, gameIds: string[]): Account | undefined;
  setPasswordHash(id: string, passwordHash: string): Account | undefined;
  /** `false` if `name` is already taken by a *different* account (case-insensitive, same rule as
   *  registration). Renaming in place preserves `id` — durable identity, same as every other profile edit. */
  setDisplayName(id: string, name: string): { account: Account | undefined; conflict: boolean };
  setAdmin(id: string, isAdmin: boolean): Account | undefined;
  setBanned(id: string, isBanned: boolean): Account | undefined;
  /** Paginated, optionally filtered by a case-insensitive substring match on `displayName`/`id`
   *  (apps/admin's account list). `total` is the filtered count, for the caller to compute page count. */
  listAccounts(opts: { q?: string | undefined; limit: number; offset: number }): { accounts: Account[]; total: number };
  /** Every account with `isAdmin` set (apps/admin's roster screen). */
  listAdmins(): Account[];
}

export interface AccountStoreOptions {
  /** Injectable clock for tests. */
  now?: () => number;
}

export const createMemoryAccountStore = (opts: AccountStoreOptions = {}): AccountStore => {
  const now = opts.now ?? (() => Date.now());
  const accounts = new Map<string, Account>();
  return {
    createAccount(displayName, passwordHash, id, friendCode) {
      const codeTaken = (c: string): boolean => {
        for (const a of accounts.values()) if (a.friendCode === c) return true;
        return false;
      };
      // Reuse the hydrated code if given and free; otherwise mint a fresh unique one.
      let code = friendCode && !codeTaken(friendCode) ? friendCode : generateFriendCode();
      while (codeTaken(code)) code = generateFriendCode();
      const account: Account = {
        id: id ?? randomUUID(),
        displayName,
        friendCode: code,
        passwordHash,
        titleAchievement: null,
        achievements: [],
        favoriteGameIds: [],
        isAdmin: false,
        isBanned: false,
      };
      accounts.set(account.id, account);
      return account;
    },
    findByDisplayName(name) {
      const needle = name.toLowerCase();
      for (const a of accounts.values()) {
        if (a.displayName.toLowerCase() === needle) return a;
      }
      return undefined;
    },
    get: (id) => accounts.get(id),
    findBySocial: (network, socialId) => {
      for (const acc of accounts.values()) {
        if (network === 'telegram' && acc.telegramId === socialId) return acc;
        if (network === 'vk' && acc.vkId === socialId) return acc;
      }
      return undefined;
    },
    linkSocial: (id, network, socialId) => {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      if (network === 'telegram') acc.telegramId = socialId;
      if (network === 'vk') acc.vkId = socialId;
      return acc;
    },
    grantAchievement(id, gameId, achievementId) {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      const existing = acc.achievements.find((a) => a.gameId === gameId && a.achievementId === achievementId);
      if (existing) return { achievement: existing, granted: false };
      const achievement: AccountAchievement = { gameId, achievementId, unlockedAt: now() };
      acc.achievements.push(achievement);
      return { achievement, granted: true };
    },
    hydrateAchievements(id, achievements) {
      const acc = accounts.get(id);
      if (acc) acc.achievements = achievements;
    },
    revokeAchievement(id, gameId, achievementId) {
      const acc = accounts.get(id);
      if (!acc) return false;
      const idx = acc.achievements.findIndex((a) => a.gameId === gameId && a.achievementId === achievementId);
      if (idx === -1) return false;
      acc.achievements.splice(idx, 1);
      return true;
    },
    setAvatar(id, dataUrl) {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      if (dataUrl === null) delete acc.avatarIcon;
      else acc.avatarIcon = dataUrl;
      return acc;
    },
    setWallpaper(id, dataUrl) {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      if (dataUrl === null) delete acc.wallpaper;
      else acc.wallpaper = dataUrl;
      return acc;
    },
    setTitleAchievement(id, ref) {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      acc.titleAchievement = ref;
      return acc;
    },
    setFavorites(id, gameIds) {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      acc.favoriteGameIds = gameIds;
      return acc;
    },
    setPasswordHash(id, passwordHash) {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      acc.passwordHash = passwordHash;
      return acc;
    },
    setDisplayName(id, name) {
      const acc = accounts.get(id);
      if (!acc) return { account: undefined, conflict: false };
      const needle = name.toLowerCase();
      for (const other of accounts.values()) {
        if (other.id !== id && other.displayName.toLowerCase() === needle) {
          return { account: undefined, conflict: true };
        }
      }
      acc.displayName = name;
      return { account: acc, conflict: false };
    },
    setAdmin(id, isAdmin) {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      acc.isAdmin = isAdmin;
      return acc;
    },
    setBanned(id, isBanned) {
      const acc = accounts.get(id);
      if (!acc) return undefined;
      acc.isBanned = isBanned;
      return acc;
    },
    listAccounts({ q, limit, offset }) {
      const needle = q?.trim().toLowerCase();
      const filtered = needle
        ? [...accounts.values()].filter(
            (a) => a.displayName.toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle),
          )
        : [...accounts.values()];
      return { accounts: filtered.slice(offset, offset + limit), total: filtered.length };
    },
    listAdmins: () => [...accounts.values()].filter((a) => a.isAdmin),
  };
};
