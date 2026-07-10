import { z } from 'zod';
import { achievement } from './achievements.js';
import { gameStat } from './stats.js';
import { titleAchievementRef } from './auth.js';

/**
 * Admin contract (HTTP) — served by `auth` (accounts/roster), `community` (changelog/discussion
 * moderation, platform settings) and `orchestrator` (game control). Every route this schema backs
 * requires the caller's account to have `isAdmin` set (see each service's own `requireAdmin`) — the
 * platform's one privileged tier, bootstrapped via `AUTH_BOOTSTRAP_ADMIN_IDS` and managed thereafter
 * through `apps/admin` itself (promote/demote via `setAdminRoleRequest`).
 */

export const adminAccountSummary = z.object({
  id: z.string(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  telegramLinked: z.boolean(),
  achievementCount: z.number(),
});
export type AdminAccountSummary = z.infer<typeof adminAccountSummary>;

export const adminAccountListResponse = z.object({
  accounts: z.array(adminAccountSummary),
  total: z.number(),
});
export type AdminAccountListResponse = z.infer<typeof adminAccountListResponse>;

export const adminAccountDetail = z.object({
  id: z.string(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  telegramLinked: z.boolean(),
  avatarIcon: z.string().nullable(),
  wallpaper: z.string().nullable(),
  titleAchievement: titleAchievementRef,
  achievements: z.array(achievement),
  favoriteGameIds: z.array(z.string()),
  stats: z.array(gameStat),
});
export type AdminAccountDetail = z.infer<typeof adminAccountDetail>;

export const setAdminRoleRequest = z.object({ isAdmin: z.boolean() });
export type SetAdminRoleRequest = z.infer<typeof setAdminRoleRequest>;

export const adminRosterResponse = z.object({ admins: z.array(adminAccountSummary) });
export type AdminRosterResponse = z.infer<typeof adminRosterResponse>;

/**
 * Platform branding/contact settings — a small fixed set of known keys rather than a freeform
 * key-value UI (see `platform_settings` table). Reads are public (e.g. a support email is
 * reasonably shown to players too); only the write is admin-gated.
 */
export const platformSettingsKeys = ['brand_name', 'support_email', 'tos_url'] as const;
export type PlatformSettingsKey = (typeof platformSettingsKeys)[number];

export const platformSettingsResponse = z.object({ settings: z.record(z.string()) });
export type PlatformSettingsResponse = z.infer<typeof platformSettingsResponse>;

export const setPlatformSettingRequest = z.object({
  key: z.enum(platformSettingsKeys),
  value: z.string().max(500),
});
export type SetPlatformSettingRequest = z.infer<typeof setPlatformSettingRequest>;
