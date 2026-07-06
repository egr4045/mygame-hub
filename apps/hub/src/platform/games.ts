/**
 * Front-end game registry for the platform hub. Mirrors the server-side game manifest the
 * orchestrator uses (id, how to wake the game, idle policy). Adding a game = one entry here
 * plus its services — that's the scalability story. Only `playable` games can be entered.
 *
 * `externalPort` marks a game that is its own SPA on its own origin (host:port). Selecting it
 * wakes the game (orchestrator) then navigates there. Every game (including CIVA) is now external —
 * the hub itself ships no game.
 */
export interface GameInfo {
  id: string;
  name: string;
  tagline: string;
  status: 'playable' | 'soon';
  accent: string;
  emoji: string;
  externalPort?: number;
}

export const GAMES: GameInfo[] = [
  {
    id: 'civa',
    name: 'CIVA',
    tagline: 'Real-time 4X · diplomacy · UN elections',
    status: 'playable',
    accent: '#3da9fc',
    emoji: '🌍',
    // CIVA is now its own SPA like every other game. Provisional dev origin — finalize in Phase 4.
    externalPort: 5180,
  },
  {
    id: 'svoyak',
    name: 'Своя игра',
    tagline: 'Quiz buzzer party · Jeopardy-style',
    status: 'playable',
    accent: '#49a05a',
    emoji: '🧠',
    externalPort: 8089,
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
    externalPort: 5190,
  },
];
