import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Clock, Logger } from '@mygame/shared-types';
import {
  createChangelogRequest,
  createPostRequest,
  createThreadRequest,
  setPlatformSettingRequest,
  updateChangelogRequest,
} from '@mygame/protocol';
import type { AuthClaims } from '@mygame/protocol';
import type { AuthCore } from '@mygame/auth-core';
import type { CommunityStore } from './store.js';

/**
 * Community HTTP app: public reads (changelog, discussions), authenticated writes. Dependencies are
 * injected as ports so the same app runs with real or fake adapters (the isolation contract).
 */
export interface AppDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly auth: AuthCore;
  readonly store: CommunityStore;
  /** Checks the caller's `is_admin` flag on the shared `accounts` table community doesn't own (see
   *  `adminCheck.ts`'s `createAdminCheck` for the real Postgres-backed implementation). A plain port,
   *  same shape as `auth`/`store`, so tests can fake it without a real database. */
  readonly isAdmin: (accountId: string) => Promise<boolean>;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
};

/** Strips the internal `deletedAt` moderation field before a thread/post row goes over the wire —
 *  it's not part of the public `discussionThread`/`discussionPost` protocol schema (every read path
 *  already filters soft-deleted rows out, so this is a contract cleanup, not a real data leak). */
const omitDeletedAt = <T extends { deletedAt: number | null }>(row: T): Omit<T, 'deletedAt'> => {
  const { deletedAt: _deletedAt, ...rest } = row;
  return rest;
};

/** Thrown by `readJson` when the body exceeds `maxBytes` — mapped to 413 by the top-level handler. */
class PayloadTooLargeError extends Error {}

/** Reads and JSON-parses the body, aborting (rather than buffering unbounded data) past `maxBytes`. */
const readJson = async (req: IncomingMessage, maxBytes = 200_000): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) throw new PayloadTooLargeError('payload too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const bearer = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
};

/** Verify the caller's access token; on failure it writes a 401 and returns null. */
const requireAccount = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: AppDeps,
): Promise<AuthClaims | null> => {
  const token = bearer(req);
  if (!token) {
    send(res, 401, { code: 'unauthorized', message: 'missing access token' });
    return null;
  }
  try {
    const claims = await deps.auth.verify(token);
    if (claims.typ !== 'access') {
      send(res, 401, { code: 'unauthorized', message: 'not an access token' });
      return null;
    }
    return claims;
  } catch {
    send(res, 401, { code: 'unauthorized', message: 'invalid access token' });
    return null;
  }
};

/** `requireAccount` plus `deps.isAdmin` — see `AppDeps.isAdmin`'s doc comment. */
const requireAdmin = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: AppDeps,
): Promise<AuthClaims | null> => {
  const claims = await requireAccount(req, res, deps);
  if (!claims) return null;
  if (!(await deps.isAdmin(claims.sub))) {
    send(res, 403, { code: 'forbidden', message: 'admin access required' });
    return null;
  }
  return claims;
};

export const createApp = (deps: AppDeps): Server =>
  createServer((req, res) => {
    void handle(req, res, deps).catch((err) => {
      if (res.headersSent) return;
      if (err instanceof PayloadTooLargeError) {
        send(res, 413, { code: 'validation', message: 'payload too large' });
        return;
      }
      deps.logger.error('unhandled', { err: String(err) });
      send(res, 500, { code: 'internal', message: 'internal error' });
    });
  });

async function handle(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  const { method, url } = req;

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (url === '/health' || url === '/ready') {
    send(res, 200, { status: 'ok', service: 'community', now: deps.clock.now() });
    return;
  }

  // --- Changelog: public reads, admin-gated writes (curated patch notes, not user content) ------
  const changelogMatch = method === 'GET' && url?.match(/^\/community\/changelog\/([^/?]+)/);
  if (changelogMatch) {
    const gameId = decodeURIComponent(changelogMatch[1]!);
    send(res, 200, { entries: deps.store.listChangelog(gameId) });
    return;
  }

  if (method === 'POST' && url === '/community/changelog') {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const parsed = createChangelogRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid changelog entry' });
      return;
    }
    const entry = deps.store.addChangelog(parsed.data);
    deps.logger.info('changelog published', { gameId: entry.gameId, version: entry.version });
    send(res, 201, entry);
    return;
  }

  const changelogIdMatch = url?.match(/^\/community\/changelog\/([^/?]+)$/);
  if (changelogIdMatch && (method === 'PUT' || method === 'DELETE')) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const id = decodeURIComponent(changelogIdMatch[1]!);

    if (method === 'DELETE') {
      const deleted = deps.store.deleteChangelog(id);
      if (!deleted) {
        send(res, 404, { code: 'not_found', message: 'changelog entry not found' });
        return;
      }
      deps.logger.info('changelog deleted', { id });
      send(res, 200, { deleted: true });
      return;
    }

    const parsed = updateChangelogRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid changelog patch' });
      return;
    }
    const updated = deps.store.updateChangelog(id, parsed.data);
    if (!updated) {
      send(res, 404, { code: 'not_found', message: 'changelog entry not found' });
      return;
    }
    deps.logger.info('changelog updated', { id });
    send(res, 200, updated);
    return;
  }

  // --- Discussions: public reads, any logged-in account may start a thread or reply ------------
  // (same trust model as chat/achievements — no per-game moderation yet, see docs/STATUS.md).
  const threadDetailMatch = method === 'GET' && url?.match(/^\/community\/threads\/[^/?]+\/([^/?]+)/);
  if (threadDetailMatch) {
    const threadId = decodeURIComponent(threadDetailMatch[1]!);
    const thread = deps.store.getThread(threadId);
    if (!thread) {
      send(res, 404, { code: 'not_found', message: 'thread not found' });
      return;
    }
    send(res, 200, { thread: omitDeletedAt(thread), posts: deps.store.postsOf(threadId).map(omitDeletedAt) });
    return;
  }

  const threadListMatch = method === 'GET' && url?.match(/^\/community\/threads\/([^/?]+)\/?$/);
  if (threadListMatch) {
    const gameId = decodeURIComponent(threadListMatch[1]!);
    send(res, 200, { threads: deps.store.listThreads(gameId).map(omitDeletedAt) });
    return;
  }

  if (method === 'POST' && url === '/community/threads') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = createThreadRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid thread' });
      return;
    }
    const { gameId, title, body } = parsed.data;
    const { thread } = deps.store.createThread(gameId, claims.sub, claims.name, title, body);
    deps.logger.info('thread created', { gameId, threadId: thread.id });
    send(res, 201, omitDeletedAt(deps.store.getThread(thread.id)!));
    return;
  }

  if (method === 'POST' && url === '/community/posts') {
    const claims = await requireAccount(req, res, deps);
    if (!claims) return;
    const parsed = createPostRequest.safeParse(await readJson(req));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid post' });
      return;
    }
    const post = deps.store.createPost(parsed.data.threadId, claims.sub, claims.name, parsed.data.body);
    if (!post) {
      send(res, 404, { code: 'not_found', message: 'thread not found' });
      return;
    }
    send(res, 201, omitDeletedAt(post));
    return;
  }

  // --- Discussion moderation: admin-only soft-delete ---------------------------------------------
  const threadDeleteMatch = method === 'DELETE' && url?.match(/^\/community\/threads\/([^/?]+)$/);
  if (threadDeleteMatch) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const threadId = decodeURIComponent(threadDeleteMatch[1]!);
    const deleted = deps.store.deleteThread(threadId);
    if (!deleted) {
      send(res, 404, { code: 'not_found', message: 'thread not found' });
      return;
    }
    deps.logger.info('thread removed', { threadId });
    send(res, 200, { deleted: true });
    return;
  }

  const postDeleteMatch = method === 'DELETE' && url?.match(/^\/community\/posts\/([^/?]+)$/);
  if (postDeleteMatch) {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    const postId = decodeURIComponent(postDeleteMatch[1]!);
    const deleted = deps.store.deletePost(postId);
    if (!deleted) {
      send(res, 404, { code: 'not_found', message: 'post not found' });
      return;
    }
    deps.logger.info('post removed', { postId });
    send(res, 200, { deleted: true });
    return;
  }

  // --- Platform settings: public read, admin-only write ------------------------------------------
  if (method === 'GET' && url === '/community/admin/settings') {
    send(res, 200, { settings: deps.store.getSettings() });
    return;
  }

  if (method === 'PUT' && url === '/community/admin/settings') {
    const claims = await requireAdmin(req, res, deps);
    if (!claims) return;
    // Sound overrides can be audio data URLs — allow a larger body than the 200 KB default.
    const parsed = setPlatformSettingRequest.safeParse(await readJson(req, 1_500_000));
    if (!parsed.success) {
      send(res, 400, { code: 'validation', message: 'invalid setting' });
      return;
    }
    deps.store.setSetting(parsed.data.key, parsed.data.value);
    deps.logger.info('platform setting updated', { key: parsed.data.key, by: claims.sub });
    send(res, 200, { settings: deps.store.getSettings() });
    return;
  }

  send(res, 404, { code: 'not_found', message: 'not found' });
}
