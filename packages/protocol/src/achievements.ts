import { z } from 'zod';

/**
 * Achievements contract (HTTP, served by `auth` — achievements live on the account). An achievement
 * is scoped per game (`gameId` + `achievementId`, opaque strings the game defines itself) so two
 * games can reuse the same achievement id without colliding. Granting is idempotent: granting an
 * already-unlocked achievement returns it unchanged with `granted: false`.
 *
 * Trust model: the caller's own access token authorizes the grant — same as the rest of the platform
 * (e.g. chat DMs aren't restricted to friends). A game's client can therefore self-report an unlock
 * that wasn't strictly earned; there is no server-side verification of "did you actually do the
 * thing". Acceptable for v1 (see docs/STATUS.md); a game that cares should grant from its own
 * trusted backend rather than its client.
 */

export const achievement = z.object({
  gameId: z.string(),
  achievementId: z.string(),
  unlockedAt: z.number(), // epoch ms
});
export type Achievement = z.infer<typeof achievement>;

export const grantAchievementRequest = z.object({
  gameId: z.string().min(1).max(64),
  achievementId: z.string().min(1).max(64),
});
export type GrantAchievementRequest = z.infer<typeof grantAchievementRequest>;

export const grantAchievementResponse = z.object({
  achievement,
  /** False if the account already had this achievement (idempotent re-grant, not a new unlock). */
  granted: z.boolean(),
});
export type GrantAchievementResponse = z.infer<typeof grantAchievementResponse>;

export const achievementsResponse = z.object({ achievements: z.array(achievement) });
export type AchievementsResponse = z.infer<typeof achievementsResponse>;

/**
 * Achievement DISPLAY catalog. Unlocks (above) are opaque `gameId + achievementId` facts; the catalog
 * is how a game tells the platform what those ids *look* like (name/description/icon/colour) so the
 * hub can render a real showcase — locked + unlocked, with descriptions — for every game, not just a
 * hard-coded one. A game registers its full catalog once (idempotent replace). Reads are public (the
 * hub shows them to everyone); registration needs a valid session (same client-trust model as granting
 * — a game's own client self-reports; a game that cares can register from its trusted backend).
 */
export const achievementDefinition = z.object({
  gameId: z.string(),
  achievementId: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  color: z.string(),
  sortOrder: z.number(),
});
export type AchievementDefinition = z.infer<typeof achievementDefinition>;

/** One catalog entry as a game supplies it (its own gameId is on the request, not repeated per item). */
export const catalogEntryInput = z.object({
  achievementId: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  icon: z.string().max(16).default('🏅'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/)
    .default('#66c0f4'),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});
export type CatalogEntryInput = z.infer<typeof catalogEntryInput>;

export const registerCatalogRequest = z.object({
  gameId: z.string().min(1).max(64),
  /** The game's FULL catalog — this replaces any previously registered set for the game. */
  achievements: z.array(catalogEntryInput).max(200),
});
export type RegisterCatalogRequest = z.infer<typeof registerCatalogRequest>;

/** All registered definitions across every game (flat; the hub groups by gameId). */
export const catalogResponse = z.object({ definitions: z.array(achievementDefinition) });
export type CatalogResponse = z.infer<typeof catalogResponse>;
