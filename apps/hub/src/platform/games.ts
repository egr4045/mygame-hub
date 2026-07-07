/**
 * Front-end game registry for the platform hub. Mirrors the server-side game manifest the
 * orchestrator uses (id, how to wake the game, idle policy). Adding a game = one entry here
 * plus its services — that's the scalability story. Only `playable` games can be entered.
 *
 * Every game (including CIVA) is its own SPA — the hub itself ships no game — reached one of two
 * ways:
 * - `path`: a path under the SAME origin as the hub (e.g. mygame-quiz.ru/example-game), once
 *   deployed — the gateway strips this prefix before proxying (deploy/gamehub/Caddyfile). Preferred:
 *   no separate port/TLS boundary, so a browser's http→https auto-upgrade can't break the navigation
 *   the way it does for `externalPort`. Only real once that game's own build supports being served
 *   from a non-root base path.
 * - `externalPort`: its own origin (host:port) — the legacy/dev model. Still the *only* option for a
 *   game whose own build/deploy hasn't migrated to `path` yet (see docs/PLAN.md), and it's also how
 *   every game is reached in local dev regardless of `path` (dev servers don't sit behind the prod
 *   gateway's path routing) — `getGameOrigin` below picks it whenever the hub itself is in dev mode.
 */
export interface GameInfo {
  id: string;
  name: string;
  tagline: string;
  status: 'playable' | 'soon' | 'maintenance';
  accent: string;
  emoji: string;
  path?: string;
  externalPort?: number;
  /** Shown instead of the Play button when `status === 'maintenance'` — why it's temporarily down. */
  note?: string;
}

/**
 * Where to navigate to enter `game`, or `null` if it has neither addressing mode configured.
 * `path` wins in a production build (same origin as the hub — no protocol mismatch possible);
 * `externalPort` is the dev fallback (and the only option for a game that hasn't migrated to `path`).
 */
export const getGameOrigin = (game: GameInfo): string | null => {
  if (game.path && !import.meta.env.DEV) return `${window.location.origin}/${game.path}`;
  if (game.externalPort) {
    // Never inherit window.location.protocol: a game's own port has no TLS of its own (no per-port
    // ACME on the deploy host), so an https hub page navigating to it must still use plain http.
    return `http://${window.location.hostname}:${game.externalPort}`;
  }
  return null;
};

export const GAMES: GameInfo[] = [
  {
    id: 'civa',
    name: 'CIVA',
    tagline: 'Real-time 4X · diplomacy · UN elections',
    status: 'maintenance',
    accent: '#3da9fc',
    emoji: '🌍',
    // Still on the legacy externalPort model (its own repo, not migrated to path-based routing yet) —
    // an https hub would hit the same SSL-upgrade bug example-game had before its fix. Disabled in the
    // UI rather than shipping a broken Play button; re-enable once it moves to `path`.
    externalPort: 5180,
    note: 'Временно недоступна в хабе — переезжает на новый роутинг (mygame-quiz.ru/civa).',
  },
  {
    id: 'svoyak',
    name: 'Своя игра',
    tagline: 'Quiz buzzer party · Jeopardy-style',
    status: 'maintenance',
    accent: '#49a05a',
    emoji: '🧠',
    externalPort: 8089,
    note: 'Временно недоступна в хабе — переезжает на новый роутинг.',
  },
  {
    id: 'leaders',
    name: 'Leaders',
    tagline: 'Political decisions · live anchor',
    status: 'soon',
    accent: '#c9a23d',
    emoji: '🏛️',
  },
  {
    id: 'example-game',
    name: 'Example Game',
    tagline: 'Живой пример @mygame/sdk — для разработчиков',
    status: 'playable',
    accent: '#8f6ef0',
    emoji: '🧩',
    // path: real once deployed (Caddy strips the prefix — deploy/gamehub/Caddyfile). externalPort
    // is the local-dev fallback (its own Vite dev server, port 5190) — getGameOrigin prefers `path`
    // only when the hub itself isn't in dev mode.
    path: 'example-game',
    externalPort: 5190,
  },
];
