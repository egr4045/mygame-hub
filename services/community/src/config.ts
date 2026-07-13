/** Environment-driven config for the community service (changelog + discussions). */
export interface ServiceConfig {
  readonly service: string;
  readonly port: number;
  readonly env: string;
  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  /** Allowed CORS origin (the hub calls this cross-origin in dev). */
  readonly corsOrigin: string;
  /** Postgres connection string. When unset, changelog/discussions are in-memory (not durable), and
   *  admin-gated routes are unreachable (see `adminCheck.ts` — no Postgres, no admin state to read). */
  readonly databaseUrl: string | undefined;
  /** Shared ops-alert bot token (same one auth polls / chat sends disk alerts with). Send-only here:
   *  a new suggestion pings the registered ops recipient. Unset → no suggestion alerts. */
  readonly opsAlertBotToken: string | undefined;
  /** Public origin, used to build the "open in admin" deep link in suggestion alerts. */
  readonly publicBaseUrl: string;
}

export const loadConfig = (): ServiceConfig => ({
  service: 'community',
  port: Number(process.env.COMMUNITY_PORT ?? 8085),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtIssuer: process.env.JWT_ISSUER ?? 'civa',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: process.env.DATABASE_URL,
  opsAlertBotToken: process.env.OPS_ALERT_BOT_TOKEN,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'https://mygame-quiz.ru',
});
