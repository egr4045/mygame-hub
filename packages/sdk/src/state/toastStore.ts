import { create } from 'zustand';

export type ToastType = 'message' | 'achievement' | 'system' | 'invite';

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** Render as the filled/accent button (default false = subtle). */
  primary?: boolean;
}

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  content: string;
  icon?: string;
  /** Sender avatar (data URL) — shown instead of the icon disc when present. */
  avatar?: string | null;
  /** Whole-toast click (e.g. open the chat). Dismisses the toast after running. */
  onClick?: () => void;
  /** Explicit action buttons (e.g. invite Join/Decline). Each dismisses the toast after running. */
  actions?: ToastAction[];
  /** Auto-dismiss after this many ms (default 5000; invites linger longer). 0 = never auto-dismiss. */
  duration?: number;
}

interface ToastState {
  toasts: ToastData[];
  addToast: (toast: Omit<ToastData, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    const ttl = toast.duration ?? 5000;
    if (ttl > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, ttl);
    }
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
