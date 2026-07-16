import type { GameManifest } from './manifest.js';

export interface ServiceConfig {
  readonly service: string;
  readonly port: number;
  readonly reaperMs: number;
  readonly games: GameManifest[];
  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  /** Postgres connection string — the orchestrator's first-ever Postgres touch, read-only (checks
   *  the shared accounts.is_admin flag for the force-stop route). Unset means that one route 501s;
   *  `GET /games`/`POST /:id/enter` stay exactly as public as they've always been. */
  readonly databaseUrl: string | undefined;
}

/** Game registry from env. Add a game = one entry here (+ its compose). */
const defaultGames = (): GameManifest[] => [
  {
    id: 'civa',
    name: 'CIVA',
    composeDir: process.env.CIVA_GAME_DIR ?? '/root/gamehub/deploy/civa-game',
    composeProject: process.env.CIVA_GAME_PROJECT ?? 'civa-game',
    activityUrl: process.env.CIVA_ACTIVITY_URL ?? 'http://lobby:8082/metrics',
    idleMs: Number(process.env.CIVA_IDLE_MS ?? 10 * 60 * 1000),
  },
  {
    id: 'svoyak',
    name: 'Своя игра',
    composeDir: process.env.SVOYAK_GAME_DIR ?? '/root/gamehub/deploy/svoyak',
    composeProject: process.env.SVOYAK_GAME_PROJECT ?? 'svoyak',
    activityUrl: process.env.SVOYAK_ACTIVITY_URL ?? 'http://svoyak:8089/metrics',
    idleMs: Number(process.env.SVOYAK_IDLE_MS ?? 10 * 60 * 1000),
  },
  {
    // Spellforge — карточная игра из отдельного репозитория (клонируется в /root/cards).
    id: 'cards',
    name: 'Spellforge',
    composeDir: process.env.CARDS_GAME_DIR ?? '/root/cards/deploy',
    composeProject: process.env.CARDS_GAME_PROJECT ?? 'cards-game',
    activityUrl: process.env.CARDS_ACTIVITY_URL ?? 'http://cards-server:8091/metrics',
    idleMs: Number(process.env.CARDS_IDLE_MS ?? 10 * 60 * 1000),
  },
];

export const loadConfig = (): ServiceConfig => ({
  service: 'orchestrator',
  port: Number(process.env.ORCHESTRATOR_PORT ?? 8090),
  reaperMs: Number(process.env.REAPER_MS ?? 30_000),
  games: defaultGames(),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtIssuer: process.env.JWT_ISSUER ?? 'gamehub',
  databaseUrl: process.env.DATABASE_URL,
});
