import { describe, expect, it } from 'vitest';
import { createCapturingLogger, createFakeClock } from '@mygame/test-harness';
import { Orchestrator, type OrchestratorDeps } from './orchestrator.js';
import type { GameManifest } from './manifest.js';
import type { ActivityProbe, ContainerRuntime, GameStatus } from './ports.js';

const game = (over: Partial<GameManifest> = {}): GameManifest => ({
  id: 'civa',
  name: 'CIVA',
  composeDir: '/x',
  composeProject: 'civa',
  activityUrl: 'http://x/metrics',
  idleMs: 1000,
  ...over,
});

class FakeRuntime implements ContainerRuntime {
  readonly states = new Map<string, GameStatus>();
  ups = 0;
  downs = 0;
  /** Optional delay so concurrent starts overlap. */
  upDelayResolvers: (() => void)[] = [];
  async status(g: GameManifest): Promise<GameStatus> {
    return this.states.get(g.id) ?? 'stopped';
  }
  async up(g: GameManifest): Promise<void> {
    this.ups++;
    this.states.set(g.id, 'running');
  }
  async down(g: GameManifest): Promise<void> {
    this.downs++;
    this.states.set(g.id, 'stopped');
  }
}

class FakeProbe implements ActivityProbe {
  count = 0;
  async players(): Promise<number> {
    return this.count;
  }
}

const setup = (games: GameManifest[]) => {
  const runtime = new FakeRuntime();
  const probe = new FakeProbe();
  const clock = createFakeClock(0);
  const deps: OrchestratorDeps = { runtime, probe, clock, logger: createCapturingLogger() };
  return { orch: new Orchestrator(games, deps), runtime, probe, clock };
};

describe('ensureUp', () => {
  it('starts a stopped game', async () => {
    const { orch, runtime } = setup([game()]);
    await orch.ensureUp('civa');
    expect(runtime.ups).toBe(1);
    expect(runtime.states.get('civa')).toBe('running');
  });

  it('does not restart an already-running game', async () => {
    const { orch, runtime } = setup([game()]);
    runtime.states.set('civa', 'running');
    await orch.ensureUp('civa');
    expect(runtime.ups).toBe(0);
  });

  it('starts exactly once under concurrent calls', async () => {
    const { orch, runtime } = setup([game()]);
    await Promise.all([orch.ensureUp('civa'), orch.ensureUp('civa'), orch.ensureUp('civa')]);
    expect(runtime.ups).toBe(1);
  });

  it('throws on unknown game', async () => {
    const { orch } = setup([game()]);
    await expect(orch.ensureUp('nope')).rejects.toThrow();
  });
});

describe('reaper (tick)', () => {
  it('stops a running game once it is idle past idleMs', async () => {
    const { orch, runtime, probe, clock } = setup([game({ idleMs: 1000 })]);
    await orch.ensureUp('civa'); // running, lastActive=0
    probe.count = 0;
    clock.set(1500); // 1.5s with 0 players > idleMs
    await orch.tick();
    expect(runtime.downs).toBe(1);
    expect(runtime.states.get('civa')).toBe('stopped');
  });

  it('keeps a game alive while it has players', async () => {
    const { orch, runtime, probe, clock } = setup([game({ idleMs: 1000 })]);
    await orch.ensureUp('civa');
    probe.count = 2;
    clock.set(5000);
    await orch.tick();
    expect(runtime.downs).toBe(0);
  });

  it('does not stop before idleMs elapses', async () => {
    const { orch, runtime, probe, clock } = setup([game({ idleMs: 1000 })]);
    await orch.ensureUp('civa');
    probe.count = 0;
    clock.set(500);
    await orch.tick();
    expect(runtime.downs).toBe(0);
  });

  it('never reaps an always-on game', async () => {
    const { orch, runtime, probe, clock } = setup([game({ id: 'shared', alwaysOn: true, idleMs: 1 })]);
    runtime.states.set('shared', 'running');
    probe.count = 0;
    clock.set(99999);
    await orch.tick();
    expect(runtime.downs).toBe(0);
  });
});

describe('list', () => {
  it('reports status + players per game', async () => {
    const { orch, runtime, probe } = setup([game()]);
    runtime.states.set('civa', 'running');
    probe.count = 3;
    const view = await orch.list();
    expect(view).toEqual([{ id: 'civa', name: 'CIVA', status: 'running', players: 3 }]);
  });
});
