/**
 * Standalone entry: runs the social service in isolation with in-memory adapters and no real
 * infrastructure. JWTs are verified with the shared dev secret (the auth service issues them).
 */
import { createAuthCore } from '@mygame/auth-core';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createSocialServer } from './server.js';
import { createMemorySocialStore } from './store.js';
import { createMemoryInviteStore } from './invites.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service, mode: 'standalone' });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});
const { httpServer } = createSocialServer({
  auth,
  store: createMemorySocialStore(),
  invites: createMemoryInviteStore(),
  logger,
  corsOrigin: config.corsOrigin,
});

httpServer.listen(config.port, () => logger.info('listening (standalone)', { port: config.port }));
