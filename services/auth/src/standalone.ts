/**
 * Standalone entry: runs the service in isolation with fake adapters and no real infrastructure.
 * This is how the module is developed and contract-tested before integration. Uses a real system
 * clock (JWT needs real time) but an in-memory account store.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createMemoryAccountStore } from './store.js';
import { createMemoryGameStatsStore } from './statsStore.js';
import { createMemoryCatalogStore } from './catalogStore.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service, mode: 'standalone' });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: config.accessTtl,
  refreshTtl: config.refreshTtl,
  handoffTtl: config.handoffTtl,
});
const app = createApp({
  clock: { now: () => Date.now() },
  logger,
  auth,
  accounts: createMemoryAccountStore(),
  stats: createMemoryGameStatsStore(),
  catalog: createMemoryCatalogStore(),
});

app.listen(config.port, () => logger.info('listening (standalone)', { port: config.port }));
