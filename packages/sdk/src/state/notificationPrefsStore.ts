/**
 * Local (per-browser, not synced) toggles for the two toasts the platform actually fires today —
 * achievement unlocks and incoming calls. Friend requests / game invites don't fire toasts (they only
 * update the 🔔 notification-center badge, a pull-based UI), so there's nothing to mute for them yet.
 */
import { create } from 'zustand';

export interface NotificationPrefs {
  achievementToasts: boolean;
  callToasts: boolean;
}

interface NotificationPrefsState extends NotificationPrefs {
  setAchievementToasts: (on: boolean) => void;
  setCallToasts: (on: boolean) => void;
}

const KEY = 'mygame.notificationPrefs';
const DEFAULTS: NotificationPrefs = { achievementToasts: true, callToasts: true };

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

export const useNotificationPrefsStore = create<NotificationPrefsState>((set, get) => ({
  ...load(),
  setAchievementToasts: (on) => {
    set({ achievementToasts: on });
    save({ achievementToasts: on, callToasts: get().callToasts });
  },
  setCallToasts: (on) => {
    set({ callToasts: on });
    save({ achievementToasts: get().achievementToasts, callToasts: on });
  },
}));
