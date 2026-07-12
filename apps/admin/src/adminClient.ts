/**
 * Admin-only API calls. Deliberately not in @mygame/sdk — the SDK is headed for open-source, and
 * ban/grant/moderate endpoints have no business in a game-facing package's autocomplete.
 */
import type {
  AdminAccountDetail,
  AdminAccountListResponse,
  AdminRosterResponse,
  ChangelogEntry,
  DiscussionPost,
  DiscussionThread,
  PlatformSettingsKey,
} from '@mygame/protocol';
import { config, freshAccessToken } from '@mygame/sdk';

const authed = async (path: string, base: string, init?: RequestInit): Promise<Response | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
};

/** Roster of every account with isAdmin set. Null on failure. */
export const getAdminRoster = async (): Promise<AdminRosterResponse | null> => {
  const res = await authed('/auth/admin/admins', config.authUrl);
  if (!res?.ok) return null;
  return (await res.json()) as AdminRosterResponse;
};

/** Paginated, optionally-searched account list. Null on failure. */
export const listAccounts = async (
  opts: { q?: string | undefined; limit?: number | undefined; offset?: number | undefined } = {},
): Promise<AdminAccountListResponse | null> => {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const qs = params.toString();
  const res = await authed(`/auth/admin/accounts${qs ? `?${qs}` : ''}`, config.authUrl);
  if (!res?.ok) return null;
  return (await res.json()) as AdminAccountListResponse;
};

/** Full detail view for one account (profile/achievements/stats). Null on failure. */
export const getAccountDetail = async (accountId: string): Promise<AdminAccountDetail | null> => {
  const res = await authed(`/auth/admin/accounts/${accountId}`, config.authUrl);
  if (!res?.ok) return null;
  return (await res.json()) as AdminAccountDetail;
};

/** Promote/demote an account. Returns false on failure (including the "last admin" server-side guard). */
export const setAdminRole = async (accountId: string, isAdmin: boolean): Promise<boolean> => {
  const res = await authed(`/auth/admin/accounts/${accountId}/role`, config.authUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isAdmin }),
  });
  return res?.ok ?? false;
};

/** Ban or unban an account. Returns false on failure. */
export const setAccountBan = async (accountId: string, isBanned: boolean): Promise<boolean> => {
  const res = await authed(`/auth/admin/accounts/${accountId}/ban`, config.authUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isBanned }),
  });
  return res?.ok ?? false;
};

/** Change an account's display name. Returns false on failure or conflict. */
export const setAccountDisplayName = async (accountId: string, displayName: string): Promise<boolean> => {
  const res = await authed(`/auth/admin/accounts/${accountId}/display-name`, config.authUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  return res?.ok ?? false;
};

/** Grant an achievement to any account (support-ticket case). Returns false on failure. */
export const grantAchievementTo = async (accountId: string, gameId: string, achievementId: string): Promise<boolean> => {
  const res = await authed(`/auth/admin/accounts/${accountId}/achievements`, config.authUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId, achievementId }),
  });
  return res?.ok ?? false;
};

/** Undo an accidental/mistaken grant. Returns false on failure. */
export const revokeAchievementFrom = async (accountId: string, gameId: string, achievementId: string): Promise<boolean> => {
  const res = await authed(`/auth/admin/accounts/${accountId}/achievements`, config.authUrl, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId, achievementId }),
  });
  return res?.ok ?? false;
};

/** Clear (never set) an account's avatar. Returns false on failure. */
export const clearAvatar = async (accountId: string): Promise<boolean> => {
  const res = await authed(`/auth/admin/accounts/${accountId}/avatar`, config.authUrl, { method: 'DELETE' });
  return res?.ok ?? false;
};

/** Clear (never set) an account's wallpaper. Returns false on failure. */
export const clearWallpaper = async (accountId: string): Promise<boolean> => {
  const res = await authed(`/auth/admin/accounts/${accountId}/wallpaper`, config.authUrl, { method: 'DELETE' });
  return res?.ok ?? false;
};

// --- Changelog (community) ------------------------------------------------------------------

/** Newest-first entries for a game. Public read — no auth needed, but goes through `authed` anyway
 *  since apps/admin is always logged in by the time it renders. Null on failure. */
export const listChangelog = async (gameId: string): Promise<ChangelogEntry[] | null> => {
  const res = await authed(`/community/changelog/${encodeURIComponent(gameId)}`, config.communityUrl);
  if (!res?.ok) return null;
  return ((await res.json()) as { entries: ChangelogEntry[] }).entries;
};

export const createChangelog = async (entry: { gameId: string; version: string; title: string; body: string }): Promise<ChangelogEntry | null> => {
  const res = await authed('/community/changelog', config.communityUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res?.ok) return null;
  return (await res.json()) as ChangelogEntry;
};

export const updateChangelog = async (
  id: string,
  patch: { version?: string; title?: string; body?: string },
): Promise<ChangelogEntry | null> => {
  const res = await authed(`/community/changelog/${id}`, config.communityUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res?.ok) return null;
  return (await res.json()) as ChangelogEntry;
};

export const deleteChangelog = async (id: string): Promise<boolean> => {
  const res = await authed(`/community/changelog/${id}`, config.communityUrl, { method: 'DELETE' });
  return res?.ok ?? false;
};

// --- Discussion moderation (community) ------------------------------------------------------

export const listThreads = async (gameId: string): Promise<DiscussionThread[] | null> => {
  const res = await authed(`/community/threads/${encodeURIComponent(gameId)}`, config.communityUrl);
  if (!res?.ok) return null;
  return ((await res.json()) as { threads: DiscussionThread[] }).threads;
};

export const getThread = async (gameId: string, threadId: string): Promise<{ thread: DiscussionThread; posts: DiscussionPost[] } | null> => {
  const res = await authed(`/community/threads/${encodeURIComponent(gameId)}/${threadId}`, config.communityUrl);
  if (!res?.ok) return null;
  return (await res.json()) as { thread: DiscussionThread; posts: DiscussionPost[] };
};

export const deleteThread = async (threadId: string): Promise<boolean> => {
  const res = await authed(`/community/threads/${threadId}`, config.communityUrl, { method: 'DELETE' });
  return res?.ok ?? false;
};

export const deletePost = async (postId: string): Promise<boolean> => {
  const res = await authed(`/community/posts/${postId}`, config.communityUrl, { method: 'DELETE' });
  return res?.ok ?? false;
};

// --- Live lobby (orchestrator) ---------------------------------------------------------------

export interface LobbyGame {
  id: string;
  name: string;
  status: 'running' | 'stopped';
  players: number;
}

/** Same `GET /games` the launcher itself calls — already public, no admin gate. Null on failure. */
export const listLobbies = async (): Promise<LobbyGame[] | null> => {
  try {
    const res = await fetch(`${config.orchestratorUrl}/games`);
    if (!res.ok) return null;
    return ((await res.json()) as { games: LobbyGame[] }).games;
  } catch {
    return null;
  }
};

/** Force-stop a running game, bypassing its idle timer. Returns false on failure (incl. 501 if the
 *  orchestrator has no DATABASE_URL configured). */
export const stopLobby = async (id: string): Promise<boolean> => {
  const res = await authed(`/games/${id}/stop`, config.orchestratorUrl, { method: 'POST' });
  return res?.ok ?? false;
};

// --- Platform settings (community) -----------------------------------------------------------

/** The small fixed set of branding/contact settings. Public read. Null on failure. */
export const getPlatformSettings = async (): Promise<Record<string, string> | null> => {
  try {
    const res = await fetch(`${config.communityUrl}/community/admin/settings`);
    if (!res.ok) return null;
    return ((await res.json()) as { settings: Record<string, string> }).settings;
  } catch {
    return null;
  }
};

/** Set one known setting key. Returns false on failure. */
export const setPlatformSetting = async (key: PlatformSettingsKey, value: string): Promise<boolean> => {
  const res = await authed('/community/admin/settings', config.communityUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  return res?.ok ?? false;
};

// --- Service health dashboard --------------------------------------------------------------

export interface ServiceHealth {
  name: string;
  url: string;
  up: boolean;
}

const HEALTH_TARGETS: ReadonlyArray<{ name: string; url: string }> = [
  { name: 'auth', url: config.authUrl },
  { name: 'social', url: config.socialUrl },
  { name: 'chat', url: config.chatUrl },
  { name: 'community', url: config.communityUrl },
  { name: 'orchestrator', url: config.orchestratorUrl },
];

/** Pings every platform service's own `/health` directly (each already exposes one, no admin gate). */
export const checkServicesHealth = async (): Promise<ServiceHealth[]> =>
  Promise.all(
    HEALTH_TARGETS.map(async ({ name, url }) => {
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
        return { name, url, up: res.ok };
      } catch {
        return { name, url, up: false };
      }
    }),
  );
