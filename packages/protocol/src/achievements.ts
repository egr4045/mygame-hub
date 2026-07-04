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
