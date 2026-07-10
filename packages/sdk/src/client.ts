/**
 * The framework-agnostic mygame client — the imperative API a game embeds via `mygame.init()`.
 * No React: games (React, Vue, vanilla) call these methods and listen to events; the SDK renders the
 * overlay itself (Phase 2 step 2). The hub uses the React hooks instead (same underlying stores).
 */
import type {
  social,
  Achievement,
  ChangelogEntry,
  DiscussionPost,
  DiscussionThread,
  GameStat,
  ProfileResponse,
  TitleAchievementRef,
} from '@mygame/protocol';
import { configure, type ConfigureOptions } from './config.js';
import {
  loadSession,
  login as authLogin,
  register as authRegister,
  clearSession,
  getHandoff,
  exchangeHandoff,
  grantAchievement,
  getAchievements,
  getProfile,
  setAvatar,
  setWallpaper,
  setTitleAchievement,
  type Session,
} from './authClient.js';
import {
  recordGameEnter,
  getGameStats,
  startPlaytimeHeartbeat,
  stopPlaytimeHeartbeat,
} from './statsClient.js';
import { getChangelog, getThreads, getThread, createThread, createPost } from './communityClient.js';
import { useSocialStore } from './state/socialStore.js';
import { useChatStore, type ChatSession } from './state/chatStore.js';
import { useMenuStore, type MenuItem } from './state/menuStore.js';
import { useToastStore, type ToastData } from './state/toastStore.js';
import { Emitter } from './emitter.js';
import { mountOverlay } from './overlay/mount.js';

/** Re-exported for convenience — `social.Activity` and protocol's flat `TitleAchievementRef` are
 *  otherwise only reachable by importing `@mygame/protocol` directly. */
export type Activity = social.Activity;
export type { TitleAchievementRef };

export interface MygameAccount {
  accountId: string;
  displayName: string;
}

export type MygameInitOptions = ConfigureOptions;

interface MygameEvents {
  ready: { gameId: string };
}

class MygameClient {
  gameId: string | null = null;
  private started = false;
  private readonly emitter = new Emitter<MygameEvents>();

  /** Bootstrap the SDK inside a game (or the hub): point at the hub and open the social link. */
  init(gameId: string, opts: MygameInitOptions = {}): void {
    this.gameId = gameId;
    configure(opts);
    if (!this.started) {
      this.started = true;
      mountOverlay();
      void this.social.connect();
      void useChatStore.getState().connect();
      // Playtime: stamp this launch and start the in-game heartbeat (server derives + clamps duration).
      void recordGameEnter(gameId);
      startPlaytimeHeartbeat(gameId);
    }
    this.emitter.emit('ready', { gameId });
  }

  readonly auth = {
    getAccount: (): MygameAccount | null => {
      const s = loadSession();
      return s ? { accountId: s.accountId, displayName: s.displayName } : null;
    },
    getToken: (): string | null => loadSession()?.accessToken ?? null,
    login: (displayName: string, password: string): Promise<Session> => authLogin(displayName, password),
    register: (displayName: string, password: string): Promise<Session> => authRegister(displayName, password),
    logout: (): void => {
      clearSession();
      stopPlaytimeHeartbeat();
      useSocialStore.getState().disconnect();
      useChatStore.getState().disconnect();
    },
    getHandoff: (): Promise<string | null> => getHandoff(),
    /** Redeem a hub `?pt=` handoff token for a session on this origin — no password needed. Null on
     *  failure (expired/invalid token). This is how a game embedding the SDK completes hub SSO. */
    loginWithToken: (handoffToken: string): Promise<Session | null> => exchangeHandoff(handoffToken),
  };

  readonly social = {
    connect: (): Promise<void> => useSocialStore.getState().connect(),
    disconnect: (): void => useSocialStore.getState().disconnect(),
    /** The live, connected identity — richer than `auth.getAccount()` (also carries avatar/title). */
    getMe: (): social.MeEvent | null => useSocialStore.getState().me,
    getFriends: (): social.Friend[] => useSocialStore.getState().friends,
    addByCode: (code: string): void => useSocialStore.getState().addByCode(code),
    setActivity: (activity: social.Activity): void => useSocialStore.getState().setActivity(activity),
    /** Currently-joinable rooms for `gameId` (defaults to the current game), from live presence. */
    getLobbies: (gameId?: string): Promise<social.Lobby[]> => {
      const id = gameId ?? this.gameId;
      return id ? useSocialStore.getState().getLobbies(id) : Promise.resolve([]);
    },
    /** Subscribe to social-store changes; returns an unsubscribe. */
    subscribe: (cb: () => void): (() => void) => useSocialStore.subscribe(cb),
  };

  readonly chat = {
    /** Toggle the chat window (the SDK-shipped widget — see `ChatWidget`). */
    open: (): void => useChatStore.getState().toggleChat(),
    /** Find-or-create a DM with `userId` and open it. */
    openWithUser: (userId: string, userName: string): void =>
      useChatStore.getState().openChatWithUser(userId, userName),
    /** Create a group (I'm added automatically) and open it. */
    createGroup: (name: string, memberIds: string[]): void => useChatStore.getState().createGroup(name, memberIds),
    /** Group only; any current member may add others. */
    addMembers: (conversationId: string, memberIds: string[]): void =>
      useChatStore.getState().addMembers(conversationId, memberIds),
    /** Group only; removes `accountId` — self-removal (leave) is always allowed, removing someone
     *  else requires being the group's owner. */
    removeMember: (conversationId: string, accountId: string): void =>
      useChatStore.getState().removeMember(conversationId, accountId),
    /** Convenience: leave a group (remove myself). */
    leaveGroup: (conversationId: string): void => useChatStore.getState().leaveGroup(conversationId),
    /** Send into an already-open conversation (dm or group) by its id. */
    send: (conversationId: string, text: string): void => useChatStore.getState().sendMessage(conversationId, text),
    /** All of my conversations (DMs + groups), newest activity first. */
    getThreads: (): ChatSession[] => useChatStore.getState().sessions,
    getUnreadCount: (): number =>
      useChatStore.getState().sessions.reduce((n, s) => n + (s.unreadCount ?? 0), 0),
    /** Subscribe to chat-store changes (new messages, thread updates); returns an unsubscribe. */
    subscribe: (cb: () => void): (() => void) => useChatStore.subscribe(cb),
  };

  readonly achievements = {
    /**
     * Grant (idempotently) an achievement for the current game to the player. Fires a toast on a
     * genuinely new unlock (never on a re-grant of one already held). Returns whether it was new.
     */
    grant: async (achievementId: string): Promise<boolean> => {
      if (!this.gameId) return false;
      const result = await grantAchievement(this.gameId, achievementId);
      if (result?.granted) {
        useToastStore.getState().addToast({
          type: 'achievement',
          title: 'Достижение получено',
          content: achievementId,
          icon: '🏆',
        });
      }
      return result?.granted ?? false;
    },
    /** The player's unlocked achievements across every game. Empty on failure/not logged in. */
    list: async (): Promise<Achievement[]> => (await getAchievements())?.achievements ?? [],
  };

  readonly profile = {
    /** Avatar/wallpaper/title, shown across every game. Null on failure/not logged in. */
    get: (): Promise<ProfileResponse | null> => getProfile(),
    /** `dataUrl` from `FileReader.readAsDataURL(file)`. Null if rejected (e.g. too large). */
    setAvatar: (dataUrl: string): Promise<string | null> => setAvatar(dataUrl),
    setWallpaper: (dataUrl: string): Promise<string | null> => setWallpaper(dataUrl),
    /** `null` clears it. Rejected if the account hasn't actually unlocked that achievement. */
    setTitle: (ref: TitleAchievementRef): Promise<boolean> => setTitleAchievement(ref),
  };

  readonly stats = {
    /** Stamp a launch of the current game. Called automatically by `init()`; call again if you
     *  re-enter without re-initializing. No-op with no gameId. */
    recordEnter: (): Promise<boolean> => (this.gameId ? recordGameEnter(this.gameId) : Promise.resolve(false)),
    /** The player's per-game playtime + last-played, across every game. Empty on failure/not logged in. */
    getStats: (): Promise<GameStat[]> => getGameStats().then((r) => r?.stats ?? []),
    /** Start the ~30s in-game playtime heartbeat (init() starts it). Idempotent. */
    startHeartbeat: (): void => {
      if (this.gameId) startPlaytimeHeartbeat(this.gameId);
    },
    /** Stop the playtime heartbeat (init's is stopped on logout). */
    stopHeartbeat: (): void => stopPlaytimeHeartbeat(),
  };

  readonly community = {
    /** Newest-first changelog entries for `gameId` (defaults to the current game). Public — no login needed. */
    getChangelog: (gameId?: string): Promise<ChangelogEntry[]> => {
      const id = gameId ?? this.gameId;
      return id ? getChangelog(id) : Promise.resolve([]);
    },
    /** Newest-first discussion threads for `gameId` (defaults to the current game). Public. */
    getThreads: (gameId?: string): Promise<DiscussionThread[]> => {
      const id = gameId ?? this.gameId;
      return id ? getThreads(id) : Promise.resolve([]);
    },
    /** A thread + its posts, oldest first. Null on failure/not found. */
    getThread: (threadId: string, gameId?: string): Promise<{ thread: DiscussionThread; posts: DiscussionPost[] } | null> => {
      const id = gameId ?? this.gameId;
      return id ? getThread(id, threadId) : Promise.resolve(null);
    },
    /** Start a discussion thread for `gameId` (defaults to the current game); `body` seeds its first post. */
    createThread: (title: string, body: string, gameId?: string): Promise<DiscussionThread | null> => {
      const id = gameId ?? this.gameId;
      return id ? createThread(id, title, body) : Promise.resolve(null);
    },
    /** Reply to a thread. */
    createPost: (threadId: string, body: string): Promise<DiscussionPost | null> => createPost(threadId, body),
  };

  readonly ui = {
    showContextMenu: (opts: { x: number; y: number; items: MenuItem[] }): void =>
      useMenuStore.getState().openMenu(opts.x, opts.y, opts.items),
    closeMenu: (): void => useMenuStore.getState().closeMenu(),
    toast: (toast: Omit<ToastData, 'id'>): void => useToastStore.getState().addToast(toast),
  };

  on<E extends keyof MygameEvents>(event: E, cb: (payload: MygameEvents[E]) => void): () => void {
    return this.emitter.on(event, cb);
  }
}

/** The singleton every game and the hub share. */
export const mygame = new MygameClient();
