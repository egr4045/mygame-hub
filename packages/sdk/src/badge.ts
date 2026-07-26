/**
 * Tab-level unread indicators: `(N)` title prefix, a favicon badge, `navigator.setAppBadge`, and a
 * title flash during an incoming ring. HOST-ACTIVATED: only the hub calls `enableTabBadge()` —
 * embedded games' titles/favicons are never touched by the SDK overlay.
 */
import { useChatStore } from './state/chatStore.js';
import { useMissedCallsStore } from './state/missedCallsStore.js';
import { useSocialStore } from './state/socialStore.js';
import {
  installFriendAcceptWatcher,
  selectUnreadNotificationCount,
  useNotificationLogStore,
} from './state/notificationsStore.js';

let enabled = false;
let baseTitle = '';
let baseFaviconHref: string | null = null;
let faviconLink: HTMLLinkElement | null = null;
let flashTimer: ReturnType<typeof setInterval> | null = null;
let flashOn = false;
let unsubs: Array<() => void> = [];

// The same count the 🔔 bell shows — one formula for both, or the tab says "1" while the panel says
// "nothing new". It is unread-*notifications*, not raw message count: read-state is server-side, so a
// notification cleared on another device stops lighting this tab too.
const currentCount = (): number => selectUnreadNotificationCount();

const ensureFaviconLink = (): HTMLLinkElement => {
  if (faviconLink) return faviconLink;
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (existing) {
    baseFaviconHref = existing.href;
    faviconLink = existing;
  } else {
    baseFaviconHref = null;
    faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    document.head.appendChild(faviconLink);
  }
  return faviconLink;
};

/** Bumped on every draw so a slow image load can't repaint a count that is already stale — without
 *  this, a `drawFavicon(2)` still decoding when `drawFavicon(0)` restores the clean icon lands
 *  afterwards and leaves a red badge on a page with nothing unread. */
let drawGeneration = 0;

/** Draw the count on (a copy of) the favicon — or on an accent disc when the page has none. */
const drawFavicon = (count: number): void => {
  const link = ensureFaviconLink();
  const generation = ++drawGeneration;
  if (count <= 0) {
    if (baseFaviconHref) link.href = baseFaviconHref;
    else link.removeAttribute('href');
    return;
  }
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const cx = canvas.getContext('2d');
  if (!cx) return;

  const paintBadge = (): void => {
    if (generation !== drawGeneration) return; // a newer draw already won
    const label = count > 99 ? '99' : String(count);
    const r = 10;
    const x = size - r;
    const y = size - r;
    cx.beginPath();
    cx.arc(x, y, r, 0, Math.PI * 2);
    cx.fillStyle = '#ef5350';
    cx.fill();
    cx.fillStyle = '#fff';
    cx.font = `bold ${label.length > 1 ? 11 : 13}px system-ui, sans-serif`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(label, x, y + 0.5);
    link.href = canvas.toDataURL('image/png');
  };

  if (baseFaviconHref) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      cx.drawImage(img, 0, 0, size, size);
      paintBadge();
    };
    img.onerror = () => {
      cx.clearRect(0, 0, size, size);
      paintBadge();
    };
    img.src = baseFaviconHref;
  } else {
    // No original favicon (the hub ships none) — an accent rounded square as the base.
    cx.fillStyle = '#4c9aff';
    cx.beginPath();
    const rr = 7;
    cx.moveTo(rr, 0);
    cx.arcTo(size, 0, size, size, rr);
    cx.arcTo(size, size, 0, size, rr);
    cx.arcTo(0, size, 0, 0, rr);
    cx.arcTo(0, 0, size, 0, rr);
    cx.fill();
    paintBadge();
  }
};

const applyCount = (): void => {
  if (!enabled) return;
  const n = currentCount();
  document.title = n > 0 ? `(${n}) ${baseTitle}` : baseTitle;
  drawFavicon(n);
  try {
    if (n > 0) void (navigator as { setAppBadge?: (n: number) => Promise<void> }).setAppBadge?.(n);
    else void (navigator as { clearAppBadge?: () => Promise<void> }).clearAppBadge?.();
  } catch {
    /* unsupported */
  }
};

const startFlash = (): void => {
  if (flashTimer) return;
  flashTimer = setInterval(() => {
    flashOn = !flashOn;
    document.title = flashOn ? '📞 Входящий звонок…' : baseTitle;
  }, 1000);
};

const stopFlash = (): void => {
  if (flashTimer) clearInterval(flashTimer);
  flashTimer = null;
  flashOn = false;
  applyCount(); // restore the (N) title
};

/** Turn tab badging on (hub only). Idempotent. */
export const enableTabBadge = (): void => {
  if (enabled || typeof document === 'undefined') return;
  enabled = true;
  baseTitle = document.title;
  // "Your request was accepted" is a transition with nothing left behind to derive it from — start
  // watching the roster for it here, where we know a real UI is up to show it.
  installFriendAcceptWatcher();
  applyCount();
  unsubs = [
    useChatStore.subscribe((s, prev) => {
      const ringingNow = s.activeCall?.status === 'ringing-in';
      const ringingBefore = prev.activeCall?.status === 'ringing-in';
      if (ringingNow && !ringingBefore) startFlash();
      else if (!ringingNow && ringingBefore) stopFlash();
      else if (!ringingNow) applyCount();
    }),
    useMissedCallsStore.subscribe(() => applyCount()),
    // Friend requests, game invites and — crucially — `readKeys`: marking something read has to
    // recompute the badge, otherwise it keeps showing what the user just cleared.
    useSocialStore.subscribe(() => applyCount()),
    useNotificationLogStore.subscribe(() => applyCount()),
  ];
};

export const disableTabBadge = (): void => {
  if (!enabled) return;
  enabled = false;
  stopFlash();
  for (const u of unsubs) u();
  unsubs = [];
  document.title = baseTitle;
  if (faviconLink) {
    if (baseFaviconHref) faviconLink.href = baseFaviconHref;
    else faviconLink.remove();
  }
  faviconLink = null;
  try {
    void (navigator as { clearAppBadge?: () => Promise<void> }).clearAppBadge?.();
  } catch {
    /* ignore */
  }
};
