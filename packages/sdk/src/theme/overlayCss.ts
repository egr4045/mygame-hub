/**
 * The single source of the SDK's tiny CSS layer (animations, hover rows, chat markdown). Injected
 * in two places, once each:
 * - into the SDK's Shadow-DOM overlay root (packages/sdk/src/overlay/mount.tsx) for embedded games;
 * - into the hub document by injectTheme() (apps/hub/src/theme.ts) — the hub renders ChatWidget &
 *   friends OUTSIDE that shadow root, so it needs the same classes.
 * Previously this was duplicated between mount.tsx and the hub's global.css; edit only here.
 */
import { mg, hexToRgba } from './tokens.js';
import { color } from '@mygame/ui-kit';

const pulse = hexToRgba(color.positive, 0.55);
const pulseEnd = hexToRgba(color.positive, 0);

export const SDK_OVERLAY_CSS = `
.mygame-fade-in { animation: mygame-fade-in ${mg.motionFast}; }
@keyframes mygame-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes mygame-call-pulse { 0% { box-shadow: 0 0 0 0 ${pulse}; } 70% { box-shadow: 0 0 0 16px ${pulseEnd}; } 100% { box-shadow: 0 0 0 0 ${pulseEnd}; } }

/* Приглашение в игру: «влетает» по центру — его нельзя не заметить (match-found). */
.mygame-invite-pop { animation: mygame-invite-pop 260ms cubic-bezier(.34,1.56,.64,1); }
@keyframes mygame-invite-pop { from { opacity: 0; transform: scale(.88) translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .mygame-invite-pop { animation: none; } }

/* ChatWidget rows: hover via CSS (keyboard/AT friendly) — active/drop states stay inline. */
.cw-hover-row:hover { background: ${mg.rowHover}; }

/* Context-menu items (same reason: CSS hover instead of JS onMouseOver mutation). */
.cw-menu-item { transition: background ${mg.motionFast}; }
.cw-menu-item:hover { background: ${mg.rowHover}; }
.cw-menu-item[data-danger='true']:hover { background: ${mg.dangerSoft}; }

/* Markdown inside chat bubbles — without these, UA margins blow the bubble up and long code/links
   overflow it. */
.chat-markdown p { margin: 0; }
.chat-markdown p + p { margin-top: 6px; }
.chat-markdown a { color: ${mg.accent}; word-break: break-all; }
.chat-markdown img { max-width: 100%; border-radius: ${mg.rSm}; }
.chat-markdown pre { background: rgba(0,0,0,0.35); padding: 8px 10px; border-radius: ${mg.rSm}; overflow-x: auto; margin: 6px 0; }
.chat-markdown code { background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 4px; font-size: 12px; word-break: break-all; }
.chat-markdown pre code { background: none; padding: 0; word-break: normal; }
.chat-markdown ul, .chat-markdown ol { margin: 4px 0; padding-left: 18px; }
.chat-markdown blockquote { margin: 4px 0; padding-left: 8px; border-left: 3px solid rgba(255,255,255,0.25); color: ${mg.textMuted}; }
.chat-markdown h1, .chat-markdown h2, .chat-markdown h3, .chat-markdown h4 { font-size: 14px; margin: 6px 0 2px; }
`;
