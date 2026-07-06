import { z } from 'zod';

/**
 * Playtime stats contract (HTTP, served by `auth` — stats live per account, like achievements).
 *
 * Two writes drive it: `recordEnter` stamps `last_played_at` when a game is launched, and
 * `heartbeat` is emitted periodically from *inside* a running game (the only place that knows the
 * session is alive — games are separate origins the hub navigates away to). The server credits the
 * elapsed time since the previous heartbeat, clamped so a missed beat / closed tab never over-credits
 * (see the auth service's stats store). The client never sends a duration — it's server-derived.
 */

export const recordEnterRequest = z.object({
  gameId: z.string().min(1).max(64),
});
export type RecordEnterRequest = z.infer<typeof recordEnterRequest>;

export const heartbeatRequest = z.object({
  gameId: z.string().min(1).max(64),
});
export type HeartbeatRequest = z.infer<typeof heartbeatRequest>;

/** The running total of credited playtime after a write. */
export const heartbeatResponse = z.object({
  secondsPlayed: z.number(),
});
export type HeartbeatResponse = z.infer<typeof heartbeatResponse>;

export const gameStat = z.object({
  gameId: z.string(),
  secondsPlayed: z.number(),
  /** Epoch ms of the last launch, or null if never launched (only heartbeated). */
  lastPlayedAt: z.number().nullable(),
});
export type GameStat = z.infer<typeof gameStat>;

export const gameStatsResponse = z.object({ stats: z.array(gameStat) });
export type GameStatsResponse = z.infer<typeof gameStatsResponse>;
