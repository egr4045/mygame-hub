/**
 * Community client: per-game changelog + discussion forum. Changelog and discussion reads are
 * public — no token needed. Publishing a changelog entry is gated server-side to the community
 * service's admin allowlist; a non-admin token still gets a clean null rather than a thrown error.
 * Creating a discussion thread/post needs only a valid session (same posture as chat/achievements).
 */
import type {
  ChangelogEntry,
  CreateChangelogRequest,
  DiscussionPost,
  DiscussionThread,
  Suggestion,
} from '@mygame/protocol';
import { config } from './config.js';
import { freshAccessToken } from './authClient.js';

/** Submit a player suggestion ("предложить идею"). Requires a session. Null on failure/not logged in.
 *  The community service also pings the author's admin on Telegram with a link. */
export const createSuggestion = async (body: string): Promise<Suggestion | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.communityUrl}/community/suggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) return null;
    return (await res.json()) as Suggestion;
  } catch {
    return null;
  }
};

/** Newest-first changelog entries for `gameId`. Empty array on failure (never throws). */
export const getChangelog = async (gameId: string): Promise<ChangelogEntry[]> => {
  try {
    const res = await fetch(`${config.communityUrl}/community/changelog/${encodeURIComponent(gameId)}`);
    if (!res.ok) return [];
    return ((await res.json()) as { entries: ChangelogEntry[] }).entries;
  } catch {
    return [];
  }
};

/** Public platform settings (brand, game-status overrides, sound overrides) — a plain key→value
 *  map. Read is public; writes are admin-only (apps/admin). Empty object on failure. */
export const getPlatformSettings = async (): Promise<Record<string, string>> => {
  try {
    const res = await fetch(`${config.communityUrl}/community/admin/settings`);
    if (!res.ok) return {};
    return ((await res.json()) as { settings: Record<string, string> }).settings ?? {};
  } catch {
    return {};
  }
};

/** Publish a changelog entry. Requires the caller's account to be a community admin. Null on failure. */
export const createChangelog = async (entry: CreateChangelogRequest): Promise<ChangelogEntry | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.communityUrl}/community/changelog`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(entry),
    });
    if (!res.ok) return null;
    return (await res.json()) as ChangelogEntry;
  } catch {
    return null;
  }
};

/** Newest-first discussion threads for `gameId`. Empty array on failure. */
export const getThreads = async (gameId: string): Promise<DiscussionThread[]> => {
  try {
    const res = await fetch(`${config.communityUrl}/community/threads/${encodeURIComponent(gameId)}`);
    if (!res.ok) return [];
    return ((await res.json()) as { threads: DiscussionThread[] }).threads;
  } catch {
    return [];
  }
};

/** A thread + its posts (oldest first, the thread's own first post included). Null on failure/not found. */
export const getThread = async (
  gameId: string,
  threadId: string,
): Promise<{ thread: DiscussionThread; posts: DiscussionPost[] } | null> => {
  try {
    const res = await fetch(
      `${config.communityUrl}/community/threads/${encodeURIComponent(gameId)}/${encodeURIComponent(threadId)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as { thread: DiscussionThread; posts: DiscussionPost[] };
  } catch {
    return null;
  }
};

/** Start a new discussion thread; `body` seeds its first post. Null on failure/not logged in. */
export const createThread = async (
  gameId: string,
  title: string,
  body: string,
): Promise<DiscussionThread | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.communityUrl}/community/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ gameId, title, body }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DiscussionThread;
  } catch {
    return null;
  }
};

/** Reply to a thread. Null on failure/not logged in/thread not found. */
export const createPost = async (threadId: string, body: string): Promise<DiscussionPost | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${config.communityUrl}/community/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ threadId, body }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DiscussionPost;
  } catch {
    return null;
  }
};
