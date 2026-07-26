/**
 * The orchestrator: wakes a game when a player enters and reaps games that sit idle, so the box
 * never burns resources on empty games. Pure control logic over injected ports — fully testable
 * without Docker. Concurrency-safe: overlapping `ensureUp` calls start a game exactly once.
 */
import type { Clock, Logger } from '@mygame/shared-types';
import type { GameManifest } from './manifest.js';
import type { ActivityProbe, ContainerRuntime, GameStatus } from './ports.js';

export interface OrchestratorDeps {
  runtime: ContainerRuntime;
  probe: ActivityProbe;
  clock: Clock;
  logger: Logger;
  /** Пауза между попытками достучаться до игры. Тесты подменяют, чтобы не ждать вживую. */
  sleep?: (ms: number) => Promise<void>;
  /** Сколько всего ждём ответа от игры, прежде чем сдаться и пустить игрока «как есть». */
  readyTimeoutMs?: number;
}

const READY_POLL_MS = 250;
const READY_TIMEOUT_MS = 25_000;

interface Tracked {
  game: GameManifest;
  lastActiveAt: number;
  starting: Promise<void> | undefined;
}

export interface GameView {
  id: string;
  name: string;
  status: GameStatus;
  players: number;
}

export class Orchestrator {
  private readonly tracked = new Map<string, Tracked>();

  constructor(
    private readonly games: GameManifest[],
    private readonly deps: OrchestratorDeps,
  ) {
    for (const g of games)
      this.tracked.set(g.id, { game: g, lastActiveAt: deps.clock.now(), starting: undefined });
  }

  /** Ensure a game is running. Idempotent; concurrent calls await one start. Marks it active. */
  async ensureUp(id: string): Promise<void> {
    const t = this.must(id);
    t.lastActiveAt = this.deps.clock.now();
    // Set the start promise synchronously so overlapping callers share one start.
    if (!t.starting) t.starting = this.doStart(t);
    await t.starting;
  }

  private async doStart(t: Tracked): Promise<void> {
    try {
      if ((await this.deps.runtime.status(t.game)) !== 'running') {
        this.deps.logger.info('starting game', { game: t.game.id });
        await this.deps.runtime.up(t.game);
        t.lastActiveAt = this.deps.clock.now();
      }
      // `docker compose up -d` возвращается, когда контейнер ЗАПУЩЕН, а не когда процесс внутри
      // начал слушать порт. Без этой паузы ensureUp рапортовал ready, хаб тут же уводил игрока
      // на игру и тот стабильно ловил 502 при первом входе. Ждём, пока игра реально ответит.
      await this.waitReady(t);
    } finally {
      t.starting = undefined;
    }
  }

  /** Опрашивает игру, пока она не ответит. По таймауту сдаётся молча: пустить игрока и показать
   *  ему ошибку игры лучше, чем держать запрос вечно. */
  private async waitReady(t: Tracked): Promise<void> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const timeout = this.deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
    // Счётчик попыток, а не часы: с подменёнными часами в тестах цикл иначе не завершится
    const attempts = Math.max(1, Math.ceil(timeout / READY_POLL_MS));
    const startedAt = this.deps.clock.now();
    for (let i = 0; i < attempts; i++) {
      try {
        await this.deps.probe.players(t.game);
        if (i > 0) this.deps.logger.info('game ready', { game: t.game.id, waitedMs: this.deps.clock.now() - startedAt });
        return;
      } catch {
        if (i + 1 < attempts) await sleep(READY_POLL_MS);
      }
    }
    this.deps.logger.error('game did not become ready in time', { game: t.game.id, timeout });
  }

  /** One reaper pass: refresh activity for running games and stop those idle past `idleMs`. */
  async tick(): Promise<void> {
    const now = this.deps.clock.now();
    for (const t of this.tracked.values()) {
      if (t.game.alwaysOn || t.starting) continue;
      if ((await this.deps.runtime.status(t.game)) !== 'running') continue;

      let players = 0;
      try {
        players = await this.deps.probe.players(t.game);
      } catch {
        players = 0; // unreachable game counts as empty
      }
      if (players > 0) {
        t.lastActiveAt = now;
        continue;
      }
      if (now - t.lastActiveAt >= t.game.idleMs) {
        this.deps.logger.info('reaping idle game', { game: t.game.id, idleFor: now - t.lastActiveAt });
        await this.deps.runtime.down(t.game);
      }
    }
  }

  /** Start the periodic reaper; returns a stop function. */
  startReaper(intervalMs: number): () => void {
    const handle = setInterval(() => {
      void this.tick().catch((e) => this.deps.logger.error('reaper error', { err: String(e) }));
    }, intervalMs);
    return () => clearInterval(handle);
  }

  /** Snapshot of every game (for the launcher's game list). */
  async list(): Promise<GameView[]> {
    return Promise.all(
      [...this.tracked.values()].map(async (t) => {
        const status = await this.deps.runtime.status(t.game);
        let players = 0;
        if (status === 'running') {
          try {
            players = await this.deps.probe.players(t.game);
          } catch {
            players = 0;
          }
        }
        return { id: t.game.id, name: t.game.name, status, players };
      }),
    );
  }

  has(id: string): boolean {
    return this.tracked.has(id);
  }

  /** Admin force-stop: bypasses the idle timer entirely (unlike `tick`'s reaper, which only ever
   *  stops a game once it's been idle past `idleMs`). No-op if already stopped or starting. */
  async forceDown(id: string): Promise<void> {
    const t = this.must(id);
    if (t.starting) return;
    if ((await this.deps.runtime.status(t.game)) !== 'running') return;
    this.deps.logger.info('force-stopping game (admin)', { game: t.game.id });
    await this.deps.runtime.down(t.game);
  }

  private must(id: string): Tracked {
    const t = this.tracked.get(id);
    if (!t) throw new Error(`unknown game ${id}`);
    return t;
  }
}
