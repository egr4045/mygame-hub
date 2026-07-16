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
  /** Root dir for the on-disk upload store (`<dataDir>/uploads`) — also the filesystem the disk
   *  monitor watches. In prod it's a named docker volume so uploads survive redeploys. */
  readonly dataDir: string;
  /** Max accepted image upload size in bytes. */
  readonly uploadMaxBytes: number;
  /** Delete messages older than this many days (0 disables the retention sweep). */
  readonly retentionDays: number;
  /** Ops-alert Telegram bot token — a SEPARATE bot from auth's linking bot. Unset disables alerts. */
  readonly opsBotToken: string | undefined;
  /** Alert when free disk drops below this fraction (0..1) OR below `diskAlertMinBytes`. */
  readonly diskAlertPct: number;
  readonly diskAlertMinBytes: number;
  /** How often the disk monitor samples free space. */
  readonly diskCheckMs: number;
}

export const loadConfig = (): ServiceConfig => ({
  service: 'chat',
  port: Number(process.env.CHAT_PORT ?? 8084),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtIssuer: process.env.JWT_ISSUER ?? 'gamehub',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: process.env.DATABASE_URL,
  livekitUrl: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
  dataDir: process.env.CHAT_DATA_DIR ?? `${process.cwd()}/.data`,
  uploadMaxBytes: Number(process.env.CHAT_UPLOAD_MAX_BYTES ?? 50 * 1024 * 1024),
  retentionDays: Number(process.env.CHAT_RETENTION_DAYS ?? 30),
  opsBotToken: process.env.OPS_ALERT_BOT_TOKEN || undefined,
  diskAlertPct: Number(process.env.CHAT_DISK_ALERT_PCT ?? 15) / 100,
  diskAlertMinBytes: Number(process.env.CHAT_DISK_ALERT_MIN_GB ?? 3) * 1024 * 1024 * 1024,
  diskCheckMs: Number(process.env.CHAT_DISK_CHECK_MS ?? 10 * 60 * 1000),
});
