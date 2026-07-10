/**
 * Standalone entry: runs the service in isolation with fake/in-memory adapters and no real
 * infrastructure. This is how the module is developed and contract-tested before integration.
 */
import { createAuthCore } from '@mygame/auth-core';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createMemoryCommunityStore } from './store.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service, mode: 'standalone' });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});
const app = createApp({
  clock: { now: () => Date.now() },
  logger,
  auth,
  store: createMemoryCommunityStore(),
  isAdmin: async () => false,
});

app.listen(config.port, () => logger.info('listening (standalone)', { port: config.port }));
