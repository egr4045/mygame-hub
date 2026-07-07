/**
 * Standalone entry: runs the chat service in isolation with in-memory adapters and no real
 * infrastructure. JWTs are verified with the shared dev secret (the auth service issues them).
 */
import { createAuthCore } from '@mygame/auth-core';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';
import { createChatServer } from './server.js';
import { createMemoryChatStore } from './store.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service, mode: 'standalone' });
const auth = createAuthCore({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  accessTtl: '15m',
  refreshTtl: '30d',
});
const { httpServer } = createChatServer({
  auth,
  store: createMemoryChatStore(),
  logger,
  corsOrigin: config.corsOrigin,
  livekit: { url: config.livekitUrl, apiKey: config.livekitApiKey, apiSecret: config.livekitApiSecret },
});

httpServer.listen(config.port, () => logger.info('listening (standalone)', { port: config.port }));
