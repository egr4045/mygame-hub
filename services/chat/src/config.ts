/** Environment-driven config for the chat service (direct messages). */
export interface ServiceConfig {
  readonly service: string;
  readonly port: number;
  readonly env: string;
  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  /** Allowed CORS origin for the Socket.io server. */
  readonly corsOrigin: string;
  /** Postgres connection string. When unset, messages are in-memory (not durable). */
  readonly databaseUrl: string | undefined;
  /** Self-hosted LiveKit instance for voice/video calls — same dev defaults as the root
   *  `infra/docker-compose.yml`'s `--dev` LiveKit, so local dev "just works" once it's up
   *  (`pnpm infra:up`). Prod sets these to GAMEHUB's own instance (never Leaders' — see docs/SERVER.md). */
  readonly livekitUrl: string;
  readonly livekitApiKey: string;
  readonly livekitApiSecret: string;
}

export const loadConfig = (): ServiceConfig => ({
  service: 'chat',
  port: Number(process.env.CHAT_PORT ?? 8084),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtIssuer: process.env.JWT_ISSUER ?? 'civa',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: process.env.DATABASE_URL,
  livekitUrl: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
});
