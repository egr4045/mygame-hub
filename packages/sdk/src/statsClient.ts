/**
 * Playtime client. `recordGameEnter` stamps a launch; the heartbeat runs a periodic beat *from inside
 * the running game* (the only place that knows the session is live — games are separate origins the
 * hub navigates away to) while the tab is visible. The server derives and clamps the credited
 * duration, so the client never sends a time span. `mygame.init()` wires enter + heartbeat for you.
 */
import type { GameStatsResponse } from '@mygame/protocol';
import { config } from './config.js';
import { freshAccessToken } from './authClient.js';

/** Stamp that the current account just launched `gameId` (sets last-played). Resolves false on failure. */
export const recordGameEnter = async (gameId: string): Promise<boolean> => {
  const token = await freshAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${config.authUrl}/auth/stats/enter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ gameId }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/** Send one playtime heartbeat for `gameId`. Returns the running total seconds, or null on failure. */
export const sendPlaytimeHeartbeat = async (gameId: string): Promise<number | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/stats/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ gameId }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { secondsPlayed: number }).secondsPlayed;
  } catch {
    return null;
  }
};

/** The current account's per-game playtime + last-played, across every game. Null on failure. */
export const getGameStats = async (): Promise<GameStatsResponse | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.authUrl}/auth/stats`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as GameStatsResponse;
  } catch {
    return null;
  }
};

const HEARTBEAT_INTERVAL_MS = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Start emitting playtime heartbeats for `gameId` every ~30s while the tab is visible. Idempotent. */
export const startPlaytimeHeartbeat = (gameId: string): void => {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void sendPlaytimeHeartbeat(gameId);
  }, HEARTBEAT_INTERVAL_MS);
};

/** Stop the playtime heartbeat (e.g. on logout / leaving the game). */
export const stopPlaytimeHeartbeat = (): void => {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};
