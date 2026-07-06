/** Environment-driven config for the community service (changelog + discussions). */
export interface ServiceConfig {
  readonly service: string;
  readonly port: number;
  readonly env: string;
  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  /** Allowed CORS origin (the hub calls this cross-origin in dev). */
  readonly corsOrigin: string;
  /** Postgres connection string. When unset, changelog/discussions are in-memory (not durable). */
  readonly databaseUrl: string | undefined;
  /** Account ids authorized to publish changelog entries. Empty = no one can (reads still work). */
  readonly adminIds: readonly string[];
}

export const loadConfig = (): ServiceConfig => ({
  service: 'community',
  port: Number(process.env.COMMUNITY_PORT ?? 8085),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtIssuer: process.env.JWT_ISSUER ?? 'civa',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: process.env.DATABASE_URL,
  adminIds: (process.env.COMMUNITY_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
