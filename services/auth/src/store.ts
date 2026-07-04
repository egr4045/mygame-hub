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

export interface Account {
  id: string;
  displayName: string;
  telegramId?: string;
  vkId?: string;
  /** Profile avatar image, as a data URL. */
  avatarIcon?: string;
  /** Profile wallpaper image, as a data URL. */
  wallpaper?: string;
  titleAchievement: TitleAchievementRef;
  achievements: AccountAchievement[];
}

export interface AccountStore {
  /** Re-claim an existing account (updating its name) or create a new one. */
  upsert(displayName: string, id?: string): Account;
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
  /** `null` clears the avatar. */
  setAvatar(id: string, dataUrl: string | null): Account | undefined;
  /** `null` clears the wallpaper. */
  setWallpaper(id: string, dataUrl: string | null): Account | undefined;
  setTitleAchievement(id: string, ref: TitleAchievementRef): Account | undefined;
}

export interface AccountStoreOptions {
  /** Injectable clock for tests. */
  now?: () => number;
}

export const createMemoryAccountStore = (opts: AccountStoreOptions = {}): AccountStore => {
  const now = opts.now ?? (() => Date.now());
  const accounts = new Map<string, Account>();
  return {
    upsert(displayName, id) {
      if (id) {
        const existing = accounts.get(id);
        if (existing) {
          existing.displayName = displayName;
          return existing;
        }
      }
      const account: Account = { id: id ?? randomUUID(), displayName, titleAchievement: null, achievements: [] };
      accounts.set(account.id, account);
      return account;
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
  };
};
