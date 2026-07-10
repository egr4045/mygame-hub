/** Standalone entry: in-memory fake Docker (no real containers) so the API can be exercised alone. */
import { createAuthCore } from '@mygame/auth-core';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { Orchestrator } from './orchestrator.js';
import type { ActivityProbe, ContainerRuntime, GameStatus } from './ports.js';

const states = new Map<string, GameStatus>();
const fakeRuntime: ContainerRuntime = {
  async status(g) {
    return states.get(g.id) ?? 'stopped';
  },
  async up(g) {
    states.set(g.id, 'running');
  },
  async down(g) {
    states.set(g.id, 'stopped');
  },
};
const fakeProbe: ActivityProbe = { async players() {
  return 0;
} };

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service, mode: 'standalone' });
const orch = new Orchestrator(config.games, {
  runtime: fakeRuntime,
  probe: fakeProbe,
  clock: { now: () => Date.now() },
  logger,
});
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});

// No Postgres in standalone mode — the admin force-stop route 501s, same as prod with no DATABASE_URL.
createApp({ orch, logger, auth, isAdmin: undefined }).listen(config.port, () =>
  logger.info('listening (standalone, fake docker)', { port: config.port }),
);
