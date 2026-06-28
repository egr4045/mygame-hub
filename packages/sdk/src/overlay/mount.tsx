import { createRoot, type Root } from 'react-dom/client';
import { MygameOverlay } from '../components/MygameOverlay.js';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/**
 * Styles injected into the overlay's shadow root. Kept tiny and self-contained so the overlay looks
 * identical on top of any game regardless of the host page's CSS (the components are otherwise
 * inline-styled). `.civa-fade-in` mirrors the hub's entrance animation.
 */
const OVERLAY_STYLES = `
.civa-fade-in { animation: mygame-fade-in 0.15s ease-out; }
@keyframes mygame-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
`;

/**
 * Mount the mygame overlay (toasts + context menu) into an isolated Shadow-DOM root on top of the
 * host game. Called by `mygame.init()`; idempotent and a no-op outside the browser. The host element
 * is click-through (`pointer-events: none`); interactive children re-enable pointer events, so the
 * game underneath stays fully usable.
 */
export const mountOverlay = (): void => {
  if (root || typeof document === 'undefined') return;
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
