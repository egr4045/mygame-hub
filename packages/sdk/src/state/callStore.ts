/**
 * Call store — the portable-call media layer. Owns the singleton LiveKit `Room` (chatStore keeps the
 * *signaling* — ring/accept/decline over the chat socket — and delegates all media here).
 *
 * Design (portable calls): a call's LiveKit room name never changes for the call's whole life. A
 * conversation call lives in room `<conversationId>`; a game-room call lives in `game:<game>:<room>`
 * — unless the host *bound* that game room onto an existing conversation call (`bindToRoom`), in
 * which case the chat service's registry resolves the game key to the conversation's room and both
 * entry paths converge on one uninterrupted call. Someone navigating hub→game drops their own leg
 * for ~1–2s and rejoins the same room (`resume()`, via localStorage on a shared origin or the
 * `?call=` URL param across origins); everyone else never reconnects.
 *
 * Media ownership: audio playback belongs to the SDK (`CallView` renders `RoomAudioRenderer` even in
 * `embedded` mode), with per-participant local volume/mute via `RemoteParticipant.setVolume`. Video
 * is handed to the host page: `attachVideo(accountId, el)` mounts a participant's camera into any
 * container the game chooses (e.g. a player card), framework-agnostic.
 */
import { create } from 'zustand';
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  ScreenSharePresets,
  RemoteParticipant,
  type Participant,
  type TrackPublication,
} from 'livekit-client';
import type { chat } from '@mygame/protocol';
import { config } from '../config.js';
import { freshAccessToken, loadSession } from '../authClient.js';

export type CallKind = 'conv' | 'game';
export type CallMediaStatus = 'idle' | 'connecting' | 'connected';

export interface CallParticipant {
  /** Platform accountId. One account can appear more than once (multi-device — e.g. PC + phone
   *  camera); those entries share `accountId` but differ in `id`. */
  accountId: string;
  /** The unique per-device LiveKit identity (`<accountId>#<device>`). Use this as the React key. */
  id: string;
  name: string;
  isLocal: boolean;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  speaking: boolean;
  /** Local playback volume (0..1) — what *I* hear, not what they broadcast. */
  volume: number;
  /** Locally muted by me (their track keeps flowing; my playback is silenced). */
  muted: boolean;
}

/** An in-call "come play with us" invite, delivered over the call's own data channel — reaches every
 *  participant regardless of friendship or which page they're on. */
export interface GameCallInvite {
  game: string;
  gameName: string;
  room: string;
  /** Base URL of the game to navigate to (origin + base path), supplied by the inviting client. */
  url: string;
  fromAccountId: string;
  fromName: string;
}

export interface CallJoinOpts {
  mic?: boolean;
  cam?: boolean;
  /** Display label for the default call surface (e.g. the conversation or game name). */
  label?: string;
  /** conv only: the ring type, persisted so a post-navigation resume can restore signaling state. */
  type?: chat.CallType;
}

interface PersistedConvCall {
  kind: 'conv';
  conversationId: string;
  label?: string;
  type?: chat.CallType;
  savedAt: number;
}
interface PersistedGameCall {
  kind: 'game';
  game: string;
  room: string;
  label?: string;
  savedAt: number;
}
type PersistedCall = PersistedConvCall | PersistedGameCall;

interface CallState {
  status: CallMediaStatus;
  kind: CallKind | null;
  /** `conv:<conversationId>` or `game:<game>:<room>` — stable id of the current call. */
  callKey: string | null;
  /** Set when `kind === 'conv'`. */
  conversationId: string | null;
  /** conv only: the ring type this call started as (audio/video). */
  callType: chat.CallType | null;
  label: string | null;
  participants: CallParticipant[];
  /** The host game renders call video itself (`attachVideo`) — the default `CallView` surface hides
   *  its chrome and keeps only the audio pipeline alive. */
  embedded: boolean;
  pendingInvite: GameCallInvite | null;
  error: string | null;

  /** Join (or re-join) a conversation call's media. Does NOT touch signaling — chatStore does. */
  joinConversation: (conversationId: string, opts?: CallJoinOpts) => Promise<boolean>;
  /** Join a game-room call (creates it on first join; resolves a host's bind to a shared room). */
  joinGameRoom: (game: string, room: string, opts?: CallJoinOpts) => Promise<boolean>;
  /** Disconnect media and clear persistence. Signaling-aware callers should prefer
   *  `mygame.call.leave()` / chatStore.hangup(), which also notify the chat service. */
  leave: () => void;

  setMic: (on: boolean) => Promise<void>;
  setCam: (on: boolean) => Promise<void>;
  setScreenShare: (on: boolean) => Promise<void>;
  /** Local playback volume for one participant (0..1). */
  setVolume: (accountId: string, volume: number) => void;
  /** Locally mute/unmute one participant's audio (my playback only). */
  setMuted: (accountId: string, muted: boolean) => void;
  /** Mount `accountId`'s camera into `el`; returns a detach function. Safe to call before their
   *  video exists — the track is attached the moment it arrives. */
  attachVideo: (accountId: string, el: HTMLElement) => () => void;
  setEmbedded: (embedded: boolean) => void;

  /** Host: alias `game:<game>:<room>` onto my current conversation call so game-side joiners land in
   *  the same LiveKit room. True if already a game call for that exact room. */
  bindToRoom: (target: { game: string; room: string }) => Promise<boolean>;
  /** Host: push a "come play" invite to every call participant over the data channel. */
  inviteToGame: (invite: { game: string; gameName: string; room: string; url: string }) => void;
  dismissInvite: () => void;

  /** Re-join the call this browser was in before a page navigation: `?call=` URL param first
   *  (cross-origin handoff), then localStorage (same-origin). Called by `mygame.init()`. */
  resume: () => Promise<void>;
}

// --- module singletons (media objects don't belong in Zustand state) --------------------------

let callRoom: Room | null = null;
/** The live LiveKit room for the current call, if connected. UI layers (CallView's RoomContext)
 *  read it directly; media events are already projected into the store's `participants`. */
export const getCallRoom = (): Room | null => callRoom;

const videoTargets = new Map<string, Set<HTMLElement>>(); // accountId -> containers
const attachedEl = new Map<HTMLElement, { track: Track; media: HTMLMediaElement }>();
const playback = new Map<string, { volume: number; muted: boolean }>(); // accountId -> local prefs

const PERSIST_KEY = 'gamehub.activeCall';
/** A persisted call older than this is stale (tab closed mid-call, not a navigation) — don't
 *  surprise-rejoin. Refreshed every minute while connected, so long sessions stay resumable. */
const PERSIST_MAX_AGE_MS = 15 * 60 * 1000;
let persistTimer: ReturnType<typeof setInterval> | null = null;
let currentPersist: PersistedCall | null = null;

const persist = (c: PersistedCall | null): void => {
  currentPersist = c;
  try {
    if (c) localStorage.setItem(PERSIST_KEY, JSON.stringify(c));
    else localStorage.removeItem(PERSIST_KEY);
  } catch {
    /* storage unavailable — resume just won't work */
  }
};

const loadPersisted = (): PersistedCall | null => {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as PersistedCall;
    if (typeof c.savedAt !== 'number' || Date.now() - c.savedAt > PERSIST_MAX_AGE_MS) {
      localStorage.removeItem(PERSIST_KEY);
      return null;
    }
    return c;
  } catch {
    return null;
  }
};

/** Parse a `?call=` param (`conv:<id>` / `game:<game>:<room>`) into a resume target. */
const parseCallKey = (raw: string): PersistedCall | null => {
  if (raw.startsWith('conv:')) {
    const conversationId = raw.slice('conv:'.length);
    return conversationId ? { kind: 'conv', conversationId, savedAt: Date.now() } : null;
  }
  if (raw.startsWith('game:')) {
    const rest = raw.slice('game:'.length);
    const sep = rest.indexOf(':');
    if (sep <= 0 || sep === rest.length - 1) return null;
    return { kind: 'game', game: rest.slice(0, sep), room: rest.slice(sep + 1), savedAt: Date.now() };
  }
  return null;
};

/** Last-picked capture device ids, persisted by the in-call DeviceMenu (`DEVICE_KEYS`). A stale id
 *  is harmless — passed as a string it's an `ideal` constraint, so the browser falls back if gone. */
const savedDevice = (key: string): string | undefined => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

/** A LiveKit room tuned for multi-party: adaptiveStream pauses/downscales offscreen video, dynacast
 *  stops publishing unused simulcast layers, and simulcast + audio processing keep quality up on
 *  constrained links. Used by every join path. */
const createCallRoom = (): Room => {
  const camId = savedDevice('mygame:call:cam');
  const micId = savedDevice('mygame:call:mic');
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution, ...(camId ? { deviceId: camId } : {}) },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(micId ? { deviceId: micId } : {}),
    },
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
      red: true,
      dtx: true,
    },
    stopLocalTrackOnUnpublish: true,
  });
};

const authedPost = async (url: string, body: unknown): Promise<Response | null> => {
  const token = await freshAccessToken();
  if (!token) return null;
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
};

const fetchToken = async (path: string, body: unknown): Promise<chat.CallTokenResponse | null> => {
  const res = await authedPost(`${config.chatUrl}${path}`, body);
  if (!res?.ok) return null;
  return (await res.json()) as chat.CallTokenResponse;
};

/** The platform accountId behind a LiveKit participant. Identity is minted `<accountId>#<device>`
 *  and the accountId also rides in `metadata`; multiple devices of one account share this. */
const accountOf = (p: { identity: string; metadata?: string | undefined }): string => {
  if (p.metadata) {
    try {
      const m = JSON.parse(p.metadata) as { accountId?: string };
      if (m.accountId) return m.accountId;
    } catch {
      /* fall through to the identity prefix */
    }
  }
  return p.identity.split('#')[0] ?? p.identity;
};

// --- video attach plumbing (keyed by base accountId, so a game's attachVideo(accountId) matches
//     whichever device is actually publishing that person's camera) --------------------------------

const detachFromContainer = (el: HTMLElement): void => {
  const attached = attachedEl.get(el);
  if (!attached) return;
  attached.track.detach(attached.media);
  attached.media.remove();
  attachedEl.delete(el);
};

const attachTrackTo = (track: Track, el: HTMLElement): void => {
  if (attachedEl.get(el)?.track === track) return;
  detachFromContainer(el);
  const media = track.attach();
  media.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  // Camera tracks are video-only; muting is belt-and-braces so no container ever double-plays audio
  // (playback is owned by RoomAudioRenderer + per-participant setVolume).
  (media as HTMLVideoElement).muted = true;
  el.appendChild(media);
  attachedEl.set(el, { track, media });
};

/** The camera track for `accountId` — across devices, the first device of that account that's
 *  actually publishing a camera (so PC-plays / phone-streams-camera resolves to the phone). */
const cameraTrackOf = (accountId: string): Track | null => {
  if (!callRoom) return null;
  for (const p of [callRoom.localParticipant, ...callRoom.remoteParticipants.values()]) {
    if (accountOf(p) !== accountId) continue;
    const track = p.getTrackPublication(Track.Source.Camera)?.track;
    if (track) return track;
  }
  return null;
};

const attachToTargets = (accountId: string): void => {
  const targets = videoTargets.get(accountId);
  if (!targets?.size) return;
  const track = cameraTrackOf(accountId);
  if (!track) return;
  for (const el of targets) attachTrackTo(track, el);
};

const detachTargets = (accountId: string): void => {
  const targets = videoTargets.get(accountId);
  if (!targets) return;
  for (const el of targets) detachFromContainer(el);
};

const detachAll = (): void => {
  for (const el of [...attachedEl.keys()]) detachFromContainer(el);
};

// --- store --------------------------------------------------------------------------------------

const toCallParticipant = (p: Participant, isLocal: boolean): CallParticipant => {
  const accountId = accountOf(p);
  const prefs = playback.get(accountId);
  return {
    accountId,
    id: p.identity,
    name: p.name || accountId,
    isLocal,
    micOn: p.isMicrophoneEnabled,
    camOn: p.isCameraEnabled,
    screenOn: p.isScreenShareEnabled,
    speaking: p.isSpeaking,
    volume: prefs?.volume ?? 1,
    muted: prefs?.muted ?? false,
  };
};

export const useCallStore = create<CallState>((set, get) => {
  const syncParticipants = (): void => {
    if (!callRoom) {
      set({ participants: [] });
      return;
    }
    const list: CallParticipant[] = [
      toCallParticipant(callRoom.localParticipant, true),
      ...[...callRoom.remoteParticipants.values()].map((p) => toCallParticipant(p, false)),
    ];
    set({ participants: list });
  };

  const applyPlayback = (accountId: string): void => {
    if (!callRoom) return;
    const prefs = playback.get(accountId);
    const vol = prefs?.muted ? 0 : (prefs?.volume ?? 1);
    // A person may be in from several devices — apply my local volume/mute to all of them.
    for (const p of callRoom.remoteParticipants.values()) {
      if (p instanceof RemoteParticipant && accountOf(p) === accountId) p.setVolume(vol);
    }
  };

  const wireRoom = (room: Room): void => {
    room.on(RoomEvent.ParticipantConnected, () => syncParticipants());
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      detachTargets(accountOf(p));
      syncParticipants();
    });
    room.on(RoomEvent.TrackSubscribed, (_track, pub: TrackPublication, participant) => {
      if (pub.source === Track.Source.Camera) attachToTargets(accountOf(participant));
      if (pub.kind === Track.Kind.Audio) applyPlayback(accountOf(participant));
      syncParticipants();
    });
    room.on(RoomEvent.TrackUnsubscribed, (_track, pub: TrackPublication, participant) => {
      if (pub.source === Track.Source.Camera) detachTargets(accountOf(participant));
      syncParticipants();
    });
    room.on(RoomEvent.LocalTrackPublished, (pub) => {
      if (pub.source === Track.Source.Camera) attachToTargets(accountOf(room.localParticipant));
      syncParticipants();
    });
    room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
      if (pub.source === Track.Source.Camera) detachTargets(accountOf(room.localParticipant));
      syncParticipants();
    });
    room.on(RoomEvent.TrackMuted, () => syncParticipants());
    room.on(RoomEvent.TrackUnmuted, () => syncParticipants());
    room.on(RoomEvent.ActiveSpeakersChanged, () => syncParticipants());
    room.on(RoomEvent.DataReceived, (payload) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as Partial<GameCallInvite> & { t?: string };
        if (
          msg.t === 'mygame.gameInvite' &&
          typeof msg.game === 'string' &&
          typeof msg.gameName === 'string' &&
          typeof msg.room === 'string' &&
          typeof msg.url === 'string'
        ) {
          set({
            pendingInvite: {
              game: msg.game,
              gameName: msg.gameName,
              room: msg.room,
              url: msg.url,
              fromAccountId: typeof msg.fromAccountId === 'string' ? msg.fromAccountId : '',
              fromName: typeof msg.fromName === 'string' ? msg.fromName : '',
            },
          });
        }
      } catch {
        /* not ours */
      }
    });
  };

  const joinInternal = async (
    kind: CallKind,
    callKey: string,
    persistAs: PersistedCall,
    tokenReq: () => Promise<chat.CallTokenResponse | null>,
    opts: CallJoinOpts,
  ): Promise<boolean> => {
    if (get().callKey === callKey && get().status !== 'idle') return true; // idempotent re-join
    if (callRoom) get().leave();

    set({
      status: 'connecting',
      kind,
      callKey,
      conversationId: kind === 'conv' ? (persistAs as PersistedConvCall).conversationId : null,
      callType: (kind === 'conv' ? (opts.type ?? 'video') : 'video') as chat.CallType,
      label: opts.label ?? null,
      error: null,
    });

    const token = await tokenReq();
    if (!token) {
      set({ status: 'idle', kind: null, callKey: null, conversationId: null, error: 'failed to join call' });
      return false;
    }

    const room = createCallRoom();
    wireRoom(room);
    try {
      await room.connect(token.url, token.token);
    } catch (err) {
      room.disconnect();
      set({ status: 'idle', kind: null, callKey: null, conversationId: null, error: String(err) });
      return false;
    }
    callRoom = room;

    // Device enablement is non-fatal (a denied mic must not kick you out of the room — you can
    // still listen/watch, e.g. as a spectator) — unlike connect() above, which is.
    try {
      await room.localParticipant.setMicrophoneEnabled(opts.mic ?? true);
    } catch {
      set({ error: 'Микрофон недоступен' });
    }
    if (opts.cam) {
      try {
        await room.localParticipant.setCameraEnabled(true);
      } catch {
        set({ error: 'Камера недоступна' });
      }
    }

    // Unexpected teardown (server drop, or give-up after auto-reconnect). Intentional exits null
    // `callRoom` first (leave()), so this guard skips those and only fires on real failures.
    room.once(RoomEvent.Disconnected, () => {
      if (callRoom !== room) return;
      callRoom = null;
      persist(null);
      detachAll();
      set({
        status: 'idle',
        kind: null,
        callKey: null,
        conversationId: null,
        participants: [],
        error: 'Соединение со звонком потеряно',
      });
    });

    persist({ ...persistAs, savedAt: Date.now() });
    if (persistTimer) clearInterval(persistTimer);
    persistTimer = setInterval(() => {
      if (currentPersist) persist({ ...currentPersist, savedAt: Date.now() });
    }, 60_000);

    set({ status: 'connected' });
    syncParticipants();
    // Attach anything already published (tracks that arrived before/during connect).
    for (const p of [callRoom.localParticipant, ...callRoom.remoteParticipants.values()]) {
      attachToTargets(accountOf(p));
      applyPlayback(accountOf(p));
    }
    return true;
  };

  return {
    status: 'idle',
    kind: null,
    callKey: null,
    conversationId: null,
    callType: null,
    label: null,
    participants: [],
    embedded: false,
    pendingInvite: null,
    error: null,

    joinConversation: (conversationId, opts = {}) =>
      joinInternal(
        'conv',
        `conv:${conversationId}`,
        { kind: 'conv', conversationId, savedAt: 0, ...(opts.label ? { label: opts.label } : {}), ...(opts.type ? { type: opts.type } : {}) },
        () => fetchToken('/chat/call/token', { conversationId }),
        opts,
      ),

    joinGameRoom: (game, room, opts = {}) =>
      joinInternal(
        'game',
        `game:${game}:${room}`,
        { kind: 'game', game, room, savedAt: 0, ...(opts.label ? { label: opts.label } : {}) },
        () => fetchToken('/chat/call/room-token', { game, room }),
        opts,
      ),

    leave: () => {
      persist(null);
      if (persistTimer) {
        clearInterval(persistTimer);
        persistTimer = null;
      }
      const room = callRoom;
      callRoom = null; // before disconnect, so the once-Disconnected guard treats this as intentional
      room?.disconnect();
      detachAll();
      set({
        status: 'idle',
        kind: null,
        callKey: null,
        conversationId: null,
        callType: null,
        label: null,
        participants: [],
        embedded: false,
        error: null,
      });
    },

    setMic: async (on) => {
      if (!callRoom) return;
      await callRoom.localParticipant.setMicrophoneEnabled(on);
      syncParticipants();
    },
    setCam: async (on) => {
      if (!callRoom) return;
      await callRoom.localParticipant.setCameraEnabled(on);
      syncParticipants();
    },
    setScreenShare: async (on) => {
      if (!callRoom) return;
      try {
        await callRoom.localParticipant.setScreenShareEnabled(on, { audio: true, contentHint: 'detail' });
      } catch {
        // user dismissed the OS picker, or capture was denied — non-fatal, leave state as-is
      }
      syncParticipants();
    },

    setVolume: (accountId, volume) => {
      const v = Math.min(1, Math.max(0, volume));
      playback.set(accountId, { volume: v, muted: playback.get(accountId)?.muted ?? false });
      applyPlayback(accountId);
      syncParticipants();
    },
    setMuted: (accountId, muted) => {
      playback.set(accountId, { volume: playback.get(accountId)?.volume ?? 1, muted });
      applyPlayback(accountId);
      syncParticipants();
    },

    attachVideo: (accountId, el) => {
      let targets = videoTargets.get(accountId);
      if (!targets) {
        targets = new Set();
        videoTargets.set(accountId, targets);
      }
      targets.add(el);
      const track = cameraTrackOf(accountId);
      if (track) attachTrackTo(track, el);
      return () => {
        targets.delete(el);
        if (!targets.size) videoTargets.delete(accountId);
        detachFromContainer(el);
      };
    },

    setEmbedded: (embedded) => set({ embedded }),

    bindToRoom: async ({ game, room }) => {
      const { kind, conversationId, callKey } = get();
      if (kind === 'game') return callKey === `game:${game}:${room}`; // already IS that room's call
      if (kind !== 'conv' || !conversationId) return false;
      const res = await authedPost(`${config.chatUrl}/chat/call/bind`, { conversationId, game, room });
      return res?.ok ?? false;
    },

    inviteToGame: ({ game, gameName, room, url }) => {
      if (!callRoom) return;
      const me = callRoom.localParticipant;
      const msg: GameCallInvite & { t: string } = {
        t: 'mygame.gameInvite',
        game,
        gameName,
        room,
        url,
        fromAccountId: me.identity,
        fromName: me.name || me.identity,
      };
      void callRoom.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true });
    },

    dismissInvite: () => set({ pendingInvite: null }),

    resume: async () => {
      if (callRoom || typeof window === 'undefined') return;
      // No session yet (e.g. init() ran before the host page finished its own auth bridge): leave
      // the `?call=` param and localStorage untouched so a later resume() — via
      // `mygame.auth.adoptSession` — can still consume them. Joining would only fail anyway.
      if (!loadSession()) return;
      let target: PersistedCall | null = null;
      try {
        const url = new URL(window.location.href);
        const raw = url.searchParams.get('call');
        if (raw) {
          url.searchParams.delete('call');
          window.history.replaceState({}, '', url.toString());
          target = parseCallKey(raw);
        }
      } catch {
        /* ignore */
      }
      target ??= loadPersisted();
      if (!target) return;
      if (target.kind === 'game') {
        await get().joinGameRoom(target.game, target.room, { mic: true, ...(target.label ? { label: target.label } : {}) });
      } else {
        // Media rejoins here; chatStore re-registers the signaling side (callAccept) once its socket
        // connects and notices this conv call is live — see chatStore's 'connect' handler.
        await get().joinConversation(target.conversationId, {
          mic: true,
          ...(target.label ? { label: target.label } : {}),
          ...(target.type ? { type: target.type } : {}),
        });
      }
    },
  };
});
