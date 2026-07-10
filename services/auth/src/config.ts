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
  /** Telegram bot token (secret). When unset, Telegram linking is disabled. */
  readonly telegramBotToken: string | undefined;
  /** Comma-separated accountIds granted is_admin on boot (idempotent — a no-op once already set).
   *  One-time bootstrap only: subsequent admins are managed via apps/admin itself (promote/demote),
   *  not by editing this and restarting. Mirrors how COMMUNITY_ADMIN_IDS used to gate changelog
   *  publishing, but persisted to the account row instead of re-checked from env on every request. */
  readonly bootstrapAdminIds: readonly string[];
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
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  bootstrapAdminIds: (process.env.AUTH_BOOTSTRAP_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
