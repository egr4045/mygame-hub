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
}

export const loadConfig = (): ServiceConfig => ({
  service: 'chat',
  port: Number(process.env.CHAT_PORT ?? 8084),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtIssuer: process.env.JWT_ISSUER ?? 'civa',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: process.env.DATABASE_URL,
});
