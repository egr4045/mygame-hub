/**
 * Local (per-browser, not synced) toggles for the two toasts the platform actually fires today —
 * achievement unlocks and incoming calls. Friend requests / game invites don't fire toasts (they only
 * update the 🔔 notification-center badge, a pull-based UI), so there's nothing to mute for them yet.
 */
import { create } from 'zustand';

export interface NotificationPrefs {
  achievementToasts: boolean;
  callToasts: boolean;
  messageToasts: boolean;
  /** Master volume (0..1) for notification sounds; 0 mutes them. */
  soundVolume: number;
}

interface NotificationPrefsState extends NotificationPrefs {
  setAchievementToasts: (on: boolean) => void;
  setCallToasts: (on: boolean) => void;
  setMessageToasts: (on: boolean) => void;
  setSoundVolume: (v: number) => void;
}

const KEY = 'mygame.notificationPrefs';
const DEFAULTS: NotificationPrefs = { achievementToasts: true, callToasts: true, messageToasts: true, soundVolume: 0.5 };

const load = (): NotificationPrefs => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
};

const save = (prefs: NotificationPrefs): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable (private mode, etc.) — prefs just won't persist across reloads.
  }
};

const snapshot = (s: NotificationPrefs): NotificationPrefs => ({
  achievementToasts: s.achievementToasts,
  callToasts: s.callToasts,
  messageToasts: s.messageToasts,
  soundVolume: s.soundVolume,
});

export const useNotificationPrefsStore = create<NotificationPrefsState>((set, get) => ({
  ...load(),
  setAchievementToasts: (on) => {
    set({ achievementToasts: on });
    save(snapshot(get()));
  },
  setCallToasts: (on) => {
    set({ callToasts: on });
    save(snapshot(get()));
  },
  setMessageToasts: (on) => {
    set({ messageToasts: on });
    save(snapshot(get()));
  },
  setSoundVolume: (v) => {
    set({ soundVolume: Math.max(0, Math.min(1, v)) });
    save(snapshot(get()));
  },
}));
