/** Production entry: real adapters (console logger, in-memory social store). */
import { createAuthCore } from '@mygame/auth-core';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createSocialServer } from './server.js';
import { createMemorySocialStore } from './store.js';
import { createMemoryInviteStore } from './invites.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
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

httpServer.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
