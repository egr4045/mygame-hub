import { createRoot, type Root } from 'react-dom/client';
import { MygameOverlay } from '../components/MygameOverlay.js';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/**
 * Styles injected into the overlay's shadow root. Kept tiny and self-contained so the overlay looks
 * identical on top of any game regardless of the host page's CSS (the components are otherwise
 * inline-styled). `.civa-fade-in` mirrors the hub's entrance animation.
 */
export const OVERLAY_STYLES = `
.civa-fade-in { animation: mygame-fade-in 0.15s ease-out; }
@keyframes mygame-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes mygame-call-pulse { 0% { box-shadow: 0 0 0 0 rgba(59,165,93,0.55); } 70% { box-shadow: 0 0 0 16px rgba(59,165,93,0); } 100% { box-shadow: 0 0 0 0 rgba(59,165,93,0); } }

/* ChatWidget rows: hover via CSS (keyboard/AT friendly) — active/drop states stay inline. */
.cw-hover-row:hover { background: #23262e; }

/* Markdown inside chat bubbles — without these, UA margins blow the bubble up and long code/links
   overflow it. Mirrored in apps/hub global.css (the hub renders ChatWidget outside this shadow root). */
.chat-markdown p { margin: 0; }
.chat-markdown p + p { margin-top: 6px; }
.chat-markdown a { color: #9fd1ff; word-break: break-all; }
.chat-markdown img { max-width: 100%; border-radius: 6px; }
.chat-markdown pre { background: rgba(0,0,0,0.35); padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
.chat-markdown code { background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 4px; font-size: 12px; word-break: break-all; }
.chat-markdown pre code { background: none; padding: 0; word-break: normal; }
.chat-markdown ul, .chat-markdown ol { margin: 4px 0; padding-left: 18px; }
.chat-markdown blockquote { margin: 4px 0; padding-left: 8px; border-left: 3px solid rgba(255,255,255,0.25); color: #b8c2cc; }
.chat-markdown h1, .chat-markdown h2, .chat-markdown h3, .chat-markdown h4 { font-size: 14px; margin: 6px 0 2px; }
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
