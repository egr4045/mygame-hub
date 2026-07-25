import { createRoot, type Root } from 'react-dom/client';
import { MygameOverlay } from '../components/MygameOverlay.js';
import { SDK_OVERLAY_CSS } from '../theme/overlayCss.js';
import { installGestureUnlock } from '../sound.js';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** @deprecated Import `SDK_OVERLAY_CSS` from the theme module instead; kept as an alias so existing consumers don't break. */
export const OVERLAY_STYLES = SDK_OVERLAY_CSS;

/**
 * Mount the mygame overlay (toasts + context menu) into an isolated Shadow-DOM root on top of the
 * host game. Called by `mygame.init()`; idempotent and a no-op outside the browser. The host element
 * is click-through (`pointer-events: none`); interactive children re-enable pointer events, so the
 * game underneath stays fully usable.
 */
export const mountOverlay = (): void => {
  if (root || typeof document === 'undefined') return;
  installGestureUnlock(); // autoplay-policy escape hatch: first user gesture unmutes a pending ring
  host = document.createElement('div');
  host.id = 'mygame-overlay';
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;
  shadow.appendChild(style);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  document.body.appendChild(host);

  root = createRoot(mountPoint);
  root.render(<MygameOverlay />);
};

/** Tear the overlay down (mainly for tests / hot-reload). */
export const unmountOverlay = (): void => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
};
