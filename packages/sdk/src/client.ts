/**
 * The framework-agnostic mygame client — the imperative API a game embeds via `mygame.init()`.
 * No React: games (React, Vue, vanilla) call these methods and listen to events; the SDK renders the
 * overlay itself (Phase 2 step 2). The hub uses the React hooks instead (same underlying stores).
 */
import type { social, Achievement, ProfileResponse, TitleAchievementRef } from '@mygame/protocol';
import { configure, type ConfigureOptions } from './config.js';
import {
  loadSession,
  login as authLogin,
  clearSession,
  getHandoff,
  grantAchievement,
  getAchievements,
  getProfile,
  setAvatar,
  setWallpaper,
  setTitleAchievement,
  type Session,
} from './authClient.js';
import { useSocialStore } from './state/socialStore.js';
import { useChatStore, type ChatSession } from './state/chatStore.js';
import { useMenuStore, type MenuItem } from './state/menuStore.js';
import { useToastStore, type ToastData } from './state/toastStore.js';
import { Emitter } from './emitter.js';
import { mountOverlay } from './overlay/mount.js';

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
    }
    this.emitter.emit('ready', { gameId });
  }

  readonly auth = {
    getAccount: (): MygameAccount | null => {
      const s = loadSession();
      return s ? { accountId: s.accountId, displayName: s.displayName } : null;
    },
    getToken: (): string | null => loadSession()?.accessToken ?? null,
    login: (displayName: string, accountId?: string): Promise<Session> =>
      authLogin(displayName, accountId),
    logout: (): void => {
      clearSession();
      useSocialStore.getState().disconnect();
      useChatStore.getState().disconnect();
    },
    getHandoff: (): Promise<string | null> => getHandoff(),
  };

  readonly social = {
    connect: (): Promise<void> => useSocialStore.getState().connect(),
    disconnect: (): void => useSocialStore.getState().disconnect(),
    getMe: (): MygameAccount | null => useSocialStore.getState().me,
    getFriends: (): social.Friend[] => useSocialStore.getState().friends,
    addByCode: (code: string): void => useSocialStore.getState().addByCode(code),
    setActivity: (activity: social.Activity): void => useSocialStore.getState().setActivity(activity),
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
