/** Environment-driven config for the auth service. */
export interface ServiceConfig {
  readonly service: string;
  readonly port: number;
  readonly env: string;
  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  readonly accessTtl: string;
  readonly refreshTtl: string;
  readonly handoffTtl: string;
  /** Postgres connection string. When unset, accounts are in-memory (not durable). */
  readonly databaseUrl: string | undefined;
}

export const loadConfig = (): ServiceConfig => ({
  service: 'auth',
  port: Number(process.env.AUTH_PORT ?? 8081),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtIssuer: process.env.JWT_ISSUER ?? 'civa',
  accessTtl: process.env.ACCESS_TTL ?? '15m',
  refreshTtl: process.env.REFRESH_TTL ?? '30d',
  handoffTtl: process.env.HANDOFF_TTL ?? '120s',
  databaseUrl: process.env.DATABASE_URL,
});
