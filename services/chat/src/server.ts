/**
 * Chat transport: a Socket.io server that authenticates each socket with the platform JWT and binds
 * it to the player's **account** (mirrors `services/social/src/server.ts`). Handles both DMs and
 * groups through the unified `Conversation` concept. On any change to a conversation, every
 * participant's thread list is refreshed (same "push the full view" model social uses); a new message
 * is also pushed immediately so an open chat window updates without waiting for the next push.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server as IOServer, type Socket } from 'socket.io';
import { AccessToken } from 'livekit-server-sdk';
import { ContractError, chat } from '@mygame/protocol';
import type { AuthCore } from '@mygame/auth-core';
import type { Logger } from '@mygame/shared-types';
import type { ZodType } from 'zod';
import type { ChatStore } from './store.js';
import { createLimiter } from './rateLimit.js';

interface SocketData {
  accountId: string;
  displayName: string;
}

export interface ChatDeps {
  readonly auth: AuthCore;
  readonly store: ChatStore;
  readonly logger: Logger;
  readonly corsOrigin: string;
  readonly livekit: { url: string; apiKey: string; apiSecret: string };
  /** Live ban check (pg-backed in production; absent = nothing is ever banned, e.g. dev/memory). */
  readonly isAccountBanned?: (accountId: string) => Promise<boolean>;
  /** How long an unanswered ring survives before the server ends it. Injectable for tests. */
  readonly ringTimeoutMs?: number;
}

/** A call is purely live state — never persisted (see the module doc comment above). */
interface ActiveCall {
  type: chat.CallType;
  /** Who started the call — the name shown on a reconnect re-ring (NOT participantIds[0], which
   *  may be someone else entirely once the originator leaves). */
  initiatorId: string;
  startedAt: number;
  participantIds: Set<string>;
  ringingIds: Set<string>;
  /** Armed while anyone is still ringing; cleared on the last accept/decline. */
  ringTimer: ReturnType<typeof setTimeout> | null;
}

/** Portable-call registry entry: which LiveKit room a `game:<game>:<room>` call actually lives in.
 *  Defaults to its own key; `/chat/call/bind` points it at an existing conversation's call instead,
 *  so a pre-game hangout call carries into the game with zero media migration (the LiveKit room name
 *  never changes — people who navigate simply rejoin the same room). Ephemeral, like `ActiveCall`. */
interface OpenCall {
  livekitRoom: string;
  createdAt: number;
}

const OPEN_CALL_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RING_TIMEOUT_MS = 60_000;

const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** MIME -> extension. The extension is always derived from the (allowlisted) MIME type, never the
 *  client filename — an uploaded `.html`/`.svg` must not come back executable from our origin. */
const UPLOAD_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** uuid + allowlisted extension only — also forecloses path traversal on GET /chat/media/. */
const MEDIA_NAME_RE = /^[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(body));
};

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const bearer = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
};

export interface ChatServer {
  httpServer: HttpServer;
  io: IOServer;
}

const parse = <T>(schema: ZodType<T>, raw: unknown): T => {
  const r = schema.safeParse(raw ?? {});
  if (!r.success) throw new ContractError('validation', 'invalid payload');
  return r.data;
};

export const createChatServer = (deps: ChatDeps): ChatServer => {
  // Ephemeral call state (see the ActiveCall doc comment) — declared here so both the HTTP token
  // route and the socket signaling handlers below can check "is the caller actually in this call".
  const activeCalls = new Map<string, ActiveCall>(); // conversationId -> call
  const openCalls = new Map<string, OpenCall>(); // 'game:<game>:<room>' -> where that call lives
  const ringTimeoutMs = deps.ringTimeoutMs ?? DEFAULT_RING_TIMEOUT_MS;

  // Abuse damping, keyed per account (IP for nothing here — every route is authenticated). Bursts
  // sized for humans typing/clicking, not scripts.
  const limits = {
    message: createLimiter(20, 1), // send/edit/delete
    typing: createLimiter(10, 1),
    call: createLimiter(10, 0.5), // socket signaling
    group: createLimiter(10, 0.5), // membership/profile/pin ops
    upload: createLimiter(5, 5 / 60), // 5/min
    callHttp: createLimiter(20, 20 / 60), // token/bind routes, 20/min
  };
  const takeOrThrow = (limiter: { take(key: string): boolean }, key: string): void => {
    if (!limiter.take(key)) throw new ContractError('rate_limited', 'слишком много запросов — подождите немного');
  };

  // 30-day upload retention, swept hourly off the request path (the old inline sweep ran an
  // O(files) stat pass on every single upload).
  const uploadDir = path.join(process.cwd(), '.data', 'uploads');
  const sweepUploads = async (): Promise<void> => {
    try {
      const files = await fs.promises.readdir(uploadDir);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const file of files) {
        const fPath = path.join(uploadDir, file);
        const stat = await fs.promises.stat(fPath).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) await fs.promises.unlink(fPath).catch(() => {});
      }
    } catch {
      /* dir may not exist yet */
    }
  };
  setInterval(() => void sweepUploads(), 60 * 60 * 1000).unref?.();
  void sweepUploads();

  const purgeOpenCalls = (): void => {
    const cutoff = Date.now() - OPEN_CALL_TTL_MS;
    for (const [key, entry] of openCalls) if (entry.createdAt < cutoff) openCalls.delete(key);
  };

  /** Verify the request's bearer token as a platform *access* token; replies 401 itself on failure. */
  const verifyAccess = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ accountId: string; displayName: string } | null> => {
    const token = bearer(req);
    if (!token) {
      sendJson(res, 401, { code: 'unauthorized', message: 'missing access token' });
      return null;
    }
    let claims;
    try {
      claims = await deps.auth.verify(token);
      if (claims.typ !== 'access') throw new Error('not an access token');
    } catch {
      sendJson(res, 401, { code: 'unauthorized', message: 'invalid access token' });
      return null;
    }
    if (deps.isAccountBanned && (await deps.isAccountBanned(claims.sub))) {
      sendJson(res, 403, { code: 'forbidden', message: 'account banned' });
      return null;
    }
    return { accountId: claims.sub, displayName: claims.name };
  };

  const mintLivekitToken = async (accountId: string, displayName: string, room: string): Promise<chat.CallTokenResponse> => {
    const at = new AccessToken(deps.livekit.apiKey, deps.livekit.apiSecret, { identity: accountId, name: displayName });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
    return { token: await at.toJwt(), url: deps.livekit.url };
  };

  const handleHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (req.url === '/health' || req.url === '/ready') {
      sendJson(res, 200, { status: 'ok', service: 'chat' });
      return;
    }

    // Mint a LiveKit room-scoped access token for an ongoing/ringing call. HTTP (not a socket event)
    // because the client needs it as a plain string to hand to livekit-client's Room.connect.
    if (req.method === 'POST' && req.url === '/chat/call/token') {
      const caller = await verifyAccess(req, res);
      if (!caller) return;
      if (!limits.callHttp.take(caller.accountId)) {
        sendJson(res, 429, { code: 'rate_limited', message: 'too many requests' });
        return;
      }
      const parsed = chat.callTokenRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        sendJson(res, 400, { code: 'validation', message: 'invalid request' });
        return;
      }
      if (!deps.store.isParticipant(parsed.data.conversationId, caller.accountId)) {
        sendJson(res, 403, { code: 'forbidden', message: 'not a participant of this conversation' });
        return;
      }
      sendJson(res, 200, await mintLivekitToken(caller.accountId, caller.displayName, parsed.data.conversationId));
      return;
    }

    // Mint a LiveKit token for a *game-room* call (portable calls). Trust model: the room code is
    // the capability — any authenticated account that knows it may join, same posture as the game's
    // own "know the 4-char code, you're in" and chat's "any known accountId can be DMed". If the
    // host bound this room onto a pre-game conversation call (`/chat/call/bind` below), the registry
    // resolves to that call's LiveKit room, so both entry paths converge on one uninterrupted call.
    if (req.method === 'POST' && req.url === '/chat/call/room-token') {
      const caller = await verifyAccess(req, res);
      if (!caller) return;
      if (!limits.callHttp.take(caller.accountId)) {
        sendJson(res, 429, { code: 'rate_limited', message: 'too many requests' });
        return;
      }
      const parsed = chat.roomCallTokenRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        sendJson(res, 400, { code: 'validation', message: 'invalid request' });
        return;
      }
      purgeOpenCalls();
      const key = `game:${parsed.data.game}:${parsed.data.room}`;
      let entry = openCalls.get(key);
      if (!entry) {
        entry = { livekitRoom: key, createdAt: Date.now() };
        openCalls.set(key, entry);
      }
      sendJson(res, 200, await mintLivekitToken(caller.accountId, caller.displayName, entry.livekitRoom));
      return;
    }

    // Bind a game room onto the caller's current conversation call: subsequent room-token requests
    // for that game room land in the conversation's LiveKit room — the call "follows" the party into
    // the game without anyone's media reconnecting. Participant-of-the-conversation only.
    if (req.method === 'POST' && req.url === '/chat/call/bind') {
      const caller = await verifyAccess(req, res);
      if (!caller) return;
      if (!limits.callHttp.take(caller.accountId)) {
        sendJson(res, 429, { code: 'rate_limited', message: 'too many requests' });
        return;
      }
      const parsed = chat.bindCallRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        sendJson(res, 400, { code: 'validation', message: 'invalid request' });
        return;
      }
      if (!deps.store.isParticipant(parsed.data.conversationId, caller.accountId)) {
        sendJson(res, 403, { code: 'forbidden', message: 'not a participant of this conversation' });
        return;
      }
      purgeOpenCalls();
      openCalls.set(`game:${parsed.data.game}:${parsed.data.room}`, {
        livekitRoom: parsed.data.conversationId,
        createdAt: Date.now(),
      });
      const body: chat.BindCallResponse = { ok: true };
      sendJson(res, 200, body);
      return;
    }

    // Image upload for chat attachments. Hardened: size-capped while streaming (not after), MIME
    // allowlist with the extension derived from the MIME (never the client filename), uploader must
    // be a participant of the destination conversation, and the returned URL is *relative* — the
    // client resolves it against its configured chat origin instead of us trusting the Host header.
    if (req.method === 'POST' && req.url?.startsWith('/chat/upload')) {
      const caller = await verifyAccess(req, res);
      if (!caller) return;
      if (!limits.upload.take(caller.accountId)) {
        sendJson(res, 429, { code: 'rate_limited', message: 'too many uploads' });
        return;
      }
      const reqUrl = new URL(req.url, 'http://local');
      const conversationId = reqUrl.searchParams.get('conversationId');
      if (!conversationId || !deps.store.isParticipant(conversationId, caller.accountId)) {
        sendJson(res, 403, { code: 'forbidden', message: 'not a participant of this conversation' });
        return;
      }
      const fileType = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      const ext = UPLOAD_TYPES[fileType];
      if (!ext) {
        sendJson(res, 415, { code: 'validation', message: 'only png/jpeg/webp/gif images are allowed' });
        return;
      }
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > UPLOAD_MAX_BYTES) {
        sendJson(res, 413, { code: 'validation', message: 'file too large (max 10 MB)' });
        return;
      }
      const fileName = (req.headers['x-file-name'] as string) || `image.${ext}`;
      const id = randomUUID();
      const filePath = path.join(process.cwd(), '.data', 'uploads', `${id}.${ext}`);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

      let received = 0;
      let overflowed = false;
      const stream = fs.createWriteStream(filePath);
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > UPLOAD_MAX_BYTES && !overflowed) {
          overflowed = true;
          req.unpipe(stream);
          stream.destroy();
          req.destroy();
        }
      });
      req.pipe(stream);
      try {
        await new Promise<void>((resolve, reject) => {
          stream.on('finish', () => resolve());
          stream.on('error', reject);
          req.on('error', reject);
        });
      } catch (err) {
        await fs.promises.unlink(filePath).catch(() => {});
        if (!overflowed) deps.logger.error('upload failed', { err: String(err) });
        if (!res.headersSent && !res.writableEnded) {
          sendJson(res, overflowed ? 413 : 500, {
            code: overflowed ? 'validation' : 'internal',
            message: overflowed ? 'file too large (max 10 MB)' : 'upload failed',
          });
        }
        return;
      }
      if (overflowed) {
        await fs.promises.unlink(filePath).catch(() => {});
        return; // connection was destroyed mid-body; nothing sensible to answer
      }

      sendJson(res, 200, { id, name: fileName, type: fileType, url: `/chat/media/${id}.${ext}` });
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/chat/media/')) {
      const filename = req.url.split('/').pop() ?? '';
      // Capability-URL serving (unguessable uuid), deliberately tokenless so <img> tags work; the
      // strict name shape is the whole defense — no traversal, no non-image types ever served.
      if (!MEDIA_NAME_RE.test(filename)) return sendJson(res, 404, { error: 'not_found' });
      const filePath = path.join(process.cwd(), '.data', 'uploads', filename);
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'not_found' });

      const dotExt = filename.slice(filename.lastIndexOf('.') + 1);
      const contentType =
        dotExt === 'png' ? 'image/png'
        : dotExt === 'webp' ? 'image/webp'
        : dotExt === 'gif' ? 'image/gif'
        : 'image/jpeg';
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...CORS_HEADERS,
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  };

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res).catch((err) => {
      if (res.headersSent) return;
      deps.logger.error('http', { err: String(err) });
      sendJson(res, 500, { code: 'internal', message: 'internal error' });
    });
  });

  // Custom path — see the matching comment in services/social/src/server.ts: on a shared production
  // origin, the default `/socket.io/` would collide with social's socket and the game lobby's.
  const io = new IOServer(httpServer, {
    path: '/chat.io/',
    cors: { origin: deps.corsOrigin, methods: ['GET', 'POST'] },
  });

  const socketsOf = new Map<string, Set<string>>(); // accountId -> connected socket ids

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token;
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    void deps.auth
      .verify(token)
      .then(async (claims) => {
        if (claims.typ !== 'access') {
          next(new Error('unauthorized'));
          return;
        }
        if (deps.isAccountBanned && (await deps.isAccountBanned(claims.sub))) {
          next(new Error('forbidden'));
          return;
        }
        (socket.data as SocketData).accountId = claims.sub;
        (socket.data as SocketData).displayName = claims.name;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  const emitTo = (accountId: string, event: string, payload: unknown): void => {
    const sockets = socketsOf.get(accountId);
    if (!sockets) return;
    for (const id of sockets) io.to(id).emit(event, payload);
  };

  const emitToEveryone = (accountIds: string[], event: string, payload: unknown): void => {
    for (const id of accountIds) emitTo(id, event, payload);
  };

  const emitThreads = (accountId: string): void => {
    if (!socketsOf.get(accountId)?.size) return;
    const payload: chat.ThreadsEvent = { threads: deps.store.threads(accountId) };
    emitTo(accountId, chat.S2C.threads, payload);
  };

  /** The ring sweep: nobody answered within `ringTimeoutMs`. A dead 1:1/empty call ends for
   *  everyone (reason `'timeout'` so the caller shows "no answer"); a live group call keeps going —
   *  only the still-ringing users get the event, which merely clears their incoming banner. */
  const expireRing = (conversationId: string, call: ActiveCall): void => {
    call.ringTimer = null;
    const stillRinging = [...call.ringingIds];
    call.ringingIds.clear();
    const isDm = deps.store.typeOf(conversationId) === 'dm';
    const payload: chat.CallEndedEvent = { conversationId, reason: 'timeout' };
    if (call.participantIds.size <= (isDm ? 1 : 0)) {
      activeCalls.delete(conversationId);
      emitToEveryone(deps.store.participantsOf(conversationId), chat.S2C.callEnded, payload);
    } else if (stillRinging.length > 0) {
      emitToEveryone(stillRinging, chat.S2C.callEnded, payload);
    }
  };

  const armRingTimer = (conversationId: string, call: ActiveCall): void => {
    if (call.ringTimer) clearTimeout(call.ringTimer);
    call.ringTimer = setTimeout(() => expireRing(conversationId, call), ringTimeoutMs);
    call.ringTimer.unref?.();
  };

  /** Once the last ringing user answered/declined there is nothing left to time out. */
  const disarmRingTimerIfIdle = (call: ActiveCall): void => {
    if (call.ringingIds.size === 0 && call.ringTimer) {
      clearTimeout(call.ringTimer);
      call.ringTimer = null;
    }
  };

  io.on('connection', (socket: Socket) => {
    const { accountId, displayName } = socket.data as SocketData;
    deps.store.upsertAccount(accountId, displayName);

    const set = socketsOf.get(accountId) ?? new Set<string>();
    set.add(socket.id);
    socketsOf.set(accountId, set);
    deps.logger.info('connect', { accountId, socket: socket.id });

    emitThreads(accountId);

    // Resend active call rings if this user was still ringing (e.g. reconnected mid-ring). The ring
    // sweep clears `ringingIds` on timeout, so a long-dead ring can never resurface here; the banner
    // names the actual initiator, not whoever happens to be first in the participant set.
    for (const [conversationId, call] of activeCalls.entries()) {
      if (call.ringingIds.has(accountId)) {
        const payload: chat.CallRingEvent = {
          conversationId,
          fromAccountId: call.initiatorId,
          fromName: deps.store.getAccount(call.initiatorId)?.displayName ?? call.initiatorId.slice(0, 8),
          callType: call.type,
        };
        socket.emit(chat.S2C.callRing, payload);
      }
    }

    const guard = (fn: () => void): void => {
      try {
        fn();
      } catch (err) {
        if (err instanceof ContractError) socket.emit(chat.S2C.error, err.toProtocol());
        else {
          deps.logger.error('handler', { err: String(err) });
          socket.emit(chat.S2C.error, { code: 'internal', message: 'internal error' });
        }
      }
    };

    socket.on(chat.C2S.openDm, (raw, ack?: (res: chat.OpenDmAck) => void) =>
      guard(() => {
        takeOrThrow(limits.group, accountId);
        const { withAccountId } = parse(chat.openDmPayload, raw);
        if (withAccountId === accountId) throw new ContractError('validation', 'cannot DM yourself');
        const conv = deps.store.openDm(accountId, withAccountId);
        if (typeof ack === 'function') ack({ conversationId: conv.id });
        emitThreads(accountId);
        emitThreads(withAccountId);
      }),
    );

    socket.on(chat.C2S.createGroup, (raw, ack?: (res: chat.CreateGroupAck) => void) =>
      guard(() => {
        takeOrThrow(limits.group, accountId);
        const { name, memberIds } = parse(chat.createGroupPayload, raw);
        const conv = deps.store.createGroup(accountId, name, memberIds);
        if (typeof ack === 'function') ack({ conversationId: conv.id });
        for (const p of conv.participantIds) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.addMembers, (raw, ack?: (res: chat.AddMembersAck) => void) =>
      guard(() => {
        takeOrThrow(limits.group, accountId);
        const { conversationId, memberIds } = parse(chat.addMembersPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const result = deps.store.addMembers(conversationId, memberIds);
        if (typeof result === 'string') throw new ContractError('validation', result);
        if (typeof ack === 'function') ack({ conversationId: result.id });
        for (const p of result.participantIds) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.removeMember, (raw, ack?: (res: chat.RemoveMemberAck) => void) =>
      guard(() => {
        takeOrThrow(limits.group, accountId);
        const { conversationId, accountId: targetId } = parse(chat.removeMemberPayload, raw);
        const isSelf = targetId === accountId;
        const conv = deps.store.threads(accountId).find(t => t.conversationId === conversationId);
        if (!conv) throw new ContractError('forbidden', 'not a participant of this conversation');

        const isOwner = conv.ownerId === accountId;
        const isAdmin = conv.admins?.includes(accountId);
        if (!isSelf && !isOwner && !isAdmin) {
          throw new ContractError('forbidden', 'only the group owner or admins may remove other members');
        }
        const before = deps.store.participantsOf(conversationId);
        const result = deps.store.removeMember(conversationId, targetId);
        if (typeof result === 'string') throw new ContractError('validation', result);
        if (typeof ack === 'function') ack({ ok: true });
        for (const p of before) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.setGroupRole, (raw, ack?: (res: chat.SetGroupRoleAck) => void) =>
      guard(() => {
        takeOrThrow(limits.group, accountId);
        const { conversationId, accountId: targetId, role } = parse(chat.setGroupRolePayload, raw);
        const conv = deps.store.threads(accountId).find(t => t.conversationId === conversationId);
        if (!conv || conv.ownerId !== accountId) {
          throw new ContractError('forbidden', 'only the owner can set roles');
        }
        const result = deps.store.setGroupRole(conversationId, targetId, role);
        if (typeof result === 'string') throw new ContractError('validation', result);
        if (typeof ack === 'function') ack({ ok: true });
        for (const p of deps.store.participantsOf(conversationId)) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.updateGroupProfile, (raw, ack?: (res: chat.UpdateGroupProfileAck) => void) =>
      guard(() => {
        takeOrThrow(limits.group, accountId);
        const { conversationId, name, avatarUrl } = parse(chat.updateGroupProfilePayload, raw);
        const conv = deps.store.threads(accountId).find(t => t.conversationId === conversationId);
        if (!conv) throw new ContractError('forbidden', 'not a participant');
        if (conv.ownerId !== accountId && !conv.admins?.includes(accountId)) {
          throw new ContractError('forbidden', 'only the owner or admins can update the profile');
        }
        const result = deps.store.updateGroupProfile(conversationId, name, avatarUrl);
        if (typeof result === 'string') throw new ContractError('validation', result);
        if (typeof ack === 'function') ack({ ok: true });
        for (const p of deps.store.participantsOf(conversationId)) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.pinMessage, (raw, ack?: (res: chat.PinMessageAck) => void) =>
      guard(() => {
        takeOrThrow(limits.group, accountId);
        const { conversationId, messageId } = parse(chat.pinMessagePayload, raw);
        const conv = deps.store.threads(accountId).find(t => t.conversationId === conversationId);
        if (!conv) throw new ContractError('forbidden', 'not a participant');
        if (conv.ownerId !== accountId && !conv.admins?.includes(accountId)) {
          throw new ContractError('forbidden', 'only the owner or admins can pin messages');
        }
        const result = deps.store.pinMessage(conversationId, messageId);
        if (typeof result === 'string') throw new ContractError('validation', result);
        if (typeof ack === 'function') ack({ ok: true });
        for (const p of deps.store.participantsOf(conversationId)) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.send, (raw, ack?: (res: chat.SendAck) => void) =>
      guard(() => {
        takeOrThrow(limits.message, accountId);
        const { conversationId, text, replyToId, mentions, attachments } = parse(chat.sendPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const message = deps.store.send(conversationId, accountId, text, { replyToId, mentions, attachments });
        if (!message) throw new ContractError('internal', 'send failed');
        const payload: chat.MessageEvent = { message };
        if (typeof ack === 'function') ack({ message });
        const participants = deps.store.participantsOf(conversationId);
        emitToEveryone(participants, chat.S2C.message, payload);
        for (const p of participants) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.edit, (raw, ack?: (res: chat.EditAck) => void) =>
      guard(() => {
        takeOrThrow(limits.message, accountId);
        const { conversationId, messageId, text } = parse(chat.editPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const result = deps.store.editMessage(conversationId, messageId, accountId, text);
        if (typeof result === 'string') {
          if (result === 'not_found') throw new ContractError('validation', 'message not found');
          throw new ContractError(
            'forbidden',
            result === 'deleted' ? 'message was deleted' : 'only the sender may edit a message',
          );
        }
        if (typeof ack === 'function') ack({ message: result });
        const participants = deps.store.participantsOf(conversationId);
        const payload: chat.MessageEditedEvent = { message: result };
        emitToEveryone(participants, chat.S2C.messageEdited, payload);
        // The thread preview may show this message — refresh everyone's list.
        for (const p of participants) emitThreads(p);
      }),
    );

    // Own messages always; others' only by the group owner/admins (never in a DM). Tombstone, so
    // ordering and reply chains survive; the store blanks text/attachments.
    socket.on(chat.C2S.del, (raw, ack?: (res: chat.DeleteAck) => void) =>
      guard(() => {
        takeOrThrow(limits.message, accountId);
        const { conversationId, messageId } = parse(chat.deletePayload, raw);
        const conv = deps.store.threads(accountId).find((t) => t.conversationId === conversationId);
        if (!conv) throw new ContractError('forbidden', 'not a participant of this conversation');
        const canModerate =
          conv.type === 'group' && (conv.ownerId === accountId || (conv.admins?.includes(accountId) ?? false));
        const result = deps.store.deleteMessage(conversationId, messageId, accountId, canModerate);
        if (typeof result === 'string') {
          if (result === 'not_found') throw new ContractError('validation', 'message not found');
          throw new ContractError('forbidden', 'you may not delete this message');
        }
        if (typeof ack === 'function') ack({ ok: true });
        const participants = deps.store.participantsOf(conversationId);
        const payload: chat.MessageDeletedEvent = {
          conversationId,
          messageId,
          deletedAt: result.deletedAt ?? Date.now(),
        };
        emitToEveryone(participants, chat.S2C.messageDeleted, payload);
        for (const p of participants) emitThreads(p);
      }),
    );

    socket.on(chat.C2S.markRead, (raw) =>
      guard(() => {
        const { conversationId } = parse(chat.markReadPayload, raw);
        const result = deps.store.markRead(conversationId, accountId);
        if (result) {
          emitThreads(accountId);
          const payload: chat.ReadEvent = { conversationId, byAccountId: accountId, upTo: result.upTo };
          const others = deps.store.participantsOf(conversationId).filter((p) => p !== accountId);
          emitToEveryone(others, chat.S2C.read, payload);
        }
      }),
    );

    socket.on(chat.C2S.getHistory, (raw, ack?: (res: chat.HistoryAck) => void) =>
      guard(() => {
        const { conversationId, limit, before } = parse(chat.getHistoryPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const page = deps.store.history(conversationId, limit ?? 100, before);
        if (typeof ack === 'function') ack({ conversationId, messages: page.messages, hasMore: page.hasMore });
      }),
    );

    socket.on(chat.C2S.getState, () => guard(() => emitThreads(accountId)));

    socket.on(chat.C2S.typing, (raw, ack?: (res: chat.TypingAck) => void) =>
      guard(() => {
        // Over-limit typing is silently dropped (not an error): it's a cosmetic signal and the
        // client fires it often by design.
        if (!limits.typing.take(accountId)) return;
        const { conversationId } = parse(chat.typingPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const others = deps.store.participantsOf(conversationId).filter((p) => p !== accountId);
        const payload: chat.TypingEvent = { conversationId, accountId };
        emitToEveryone(others, chat.S2C.typing, payload);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    /** Remove `accountId` from `conversationId`'s call; ends it (broadcasting callEnded) once empty or 1 person left in DM. */
    const leaveCall = (conversationId: string): void => {
      const call = activeCalls.get(conversationId);
      if (!call?.participantIds.delete(accountId)) return;

      const isDm = deps.store.typeOf(conversationId) === 'dm';
      const threshold = isDm ? 1 : 0;

      call.ringingIds.delete(accountId);
      disarmRingTimerIfIdle(call);

      if (call.participantIds.size <= threshold) {
        if (call.ringTimer) clearTimeout(call.ringTimer);
        activeCalls.delete(conversationId);
        const payload: chat.CallEndedEvent = { conversationId, reason: 'ended' };
        emitToEveryone(deps.store.participantsOf(conversationId), chat.S2C.callEnded, payload);
      }
    };

    // Voice/video call signaling — ephemeral (`activeCalls` above), no store/Postgres involvement;
    // the actual media flows over LiveKit once a client has a token from `POST /chat/call/token`.
    socket.on(chat.C2S.callRing, (raw, ack?: (res: chat.CallAck) => void) =>
      guard(() => {
        takeOrThrow(limits.call, accountId);
        const { conversationId, callType } = parse(chat.callRingPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const others = deps.store.participantsOf(conversationId).filter((p) => p !== accountId);
        let call = activeCalls.get(conversationId);
        if (call) {
          call.participantIds.add(accountId);
          call.ringingIds.delete(accountId);
        } else {
          call = {
            type: callType,
            initiatorId: accountId,
            startedAt: Date.now(),
            participantIds: new Set([accountId]),
            ringingIds: new Set<string>(),
            ringTimer: null,
          };
          activeCalls.set(conversationId, call);
        }
        // Never (re-)ring someone already connected to this very call — they'd get a spurious
        // incoming-call banner mid-call.
        const ringTargets = others.filter((p) => !call.participantIds.has(p));
        for (const p of ringTargets) call.ringingIds.add(p);
        armRingTimer(conversationId, call);
        const payload: chat.CallRingEvent = { conversationId, fromAccountId: accountId, fromName: displayName, callType };
        emitToEveryone(ringTargets, chat.S2C.callRing, payload);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    socket.on(chat.C2S.callAccept, (raw, ack?: (res: chat.CallAck) => void) =>
      guard(() => {
        takeOrThrow(limits.call, accountId);
        const { conversationId } = parse(chat.callActionPayload, raw);
        const call = activeCalls.get(conversationId);
        if (!call) throw new ContractError('validation', 'no call in progress');
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        call.participantIds.add(accountId);
        call.ringingIds.delete(accountId);
        disarmRingTimerIfIdle(call);
        const payload: chat.CallParticipantEvent = { conversationId, accountId };
        emitToEveryone([...call.participantIds], chat.S2C.callAccepted, payload);
        if (typeof ack === 'function') ack({ ok: true });
      }),
    );

    // Declining doesn't unilaterally end the call (a group call goes on for whoever's already
    // joined) — it only informs the ringer(s), who decide client-side whether to hang up (e.g. a 1:1
    // call has no one left to wait for, so the ringer's own client reacts by hanging up itself).
    // Participant-only: without the guard an outsider could broadcast a spoofed decline and make a
    // 1:1 caller's client hang up someone else's call.
    socket.on(chat.C2S.callDecline, (raw) =>
      guard(() => {
        takeOrThrow(limits.call, accountId);
        const { conversationId } = parse(chat.callActionPayload, raw);
        if (!deps.store.isParticipant(conversationId, accountId)) {
          throw new ContractError('forbidden', 'not a participant of this conversation');
        }
        const call = activeCalls.get(conversationId);
        if (call) {
          call.ringingIds.delete(accountId);
          disarmRingTimerIfIdle(call);
        }
        const payload: chat.CallParticipantEvent = { conversationId, accountId };
        const others = deps.store.participantsOf(conversationId).filter((p) => p !== accountId);
        emitToEveryone(others, chat.S2C.callDeclined, payload);
      }),
    );

    socket.on(chat.C2S.callHangup, (raw) =>
      guard(() => {
        takeOrThrow(limits.call, accountId);
        const { conversationId } = parse(chat.callActionPayload, raw);
        leaveCall(conversationId);
      }),
    );

    socket.on('disconnect', () => {
      const sockets = socketsOf.get(accountId);
      sockets?.delete(socket.id);
      if (sockets && sockets.size === 0) {
        socketsOf.delete(accountId);
        // Fully offline (no other tabs/devices) — drop out of any call rather than leave a ghost
        // participant nobody can ever remove.
        for (const conversationId of [...activeCalls.keys()]) leaveCall(conversationId);
      }
    });
  });

  return { httpServer, io };
};
