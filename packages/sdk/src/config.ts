/**
 * Runtime configuration for the platform services (auth + social + chat + community) the SDK talks to.
 *
 * Defaults: dev → localhost ports; prod → same origin (the hub serves the services behind its
 * gateway, so one build works on a raw port or a subdomain). A game embedding the SDK points it at
 * the hub with `mygame.init(id, { hubUrl })`, which calls `configure()` below before any request.
 *
 * `import.meta.env` is read as a single inline-cast expression (not split across a variable) so
 * Vite's dev-mode static analysis still recognizes and injects it; splitting it into a separate
 * `meta` variable silently defeats that detection and every default below falls through to
 * `sameOrigin` even in dev. The cast itself still means the SDK carries no bundler-specific ambient
 * types and degrades to `{}` (not a crash) when running outside Vite.
 */
const sameOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export interface PlatformConfig {
  authUrl: string;
  socialUrl: string;
  chatUrl: string;
  communityUrl: string;
}

export const config: PlatformConfig = {
  authUrl: env.VITE_AUTH_URL ?? (env.DEV ? 'http://localhost:8081' : sameOrigin),
  socialUrl: env.VITE_SOCIAL_URL ?? (env.DEV ? 'http://localhost:8083' : sameOrigin),
  chatUrl: env.VITE_CHAT_URL ?? (env.DEV ? 'http://localhost:8084' : sameOrigin),
  communityUrl: env.VITE_COMMUNITY_URL ?? (env.DEV ? 'http://localhost:8085' : sameOrigin),
};

export interface ConfigureOptions {
  /** Base URL of the hub; sets auth, social, chat and community unless one is overridden below. */
  hubUrl?: string;
  authUrl?: string;
  socialUrl?: string;
  chatUrl?: string;
  communityUrl?: string;
}

/** Point the SDK at a hub. Called by `mygame.init`; safe to call again to re-point. */
export const configure = (opts: ConfigureOptions): void => {
  if (opts.hubUrl !== undefined) {
    config.authUrl = opts.hubUrl;
    config.socialUrl = opts.hubUrl;
    config.chatUrl = opts.hubUrl;
    config.communityUrl = opts.hubUrl;
  }
  if (opts.authUrl !== undefined) config.authUrl = opts.authUrl;
  if (opts.socialUrl !== undefined) config.socialUrl = opts.socialUrl;
  if (opts.chatUrl !== undefined) config.chatUrl = opts.chatUrl;
  if (opts.communityUrl !== undefined) config.communityUrl = opts.communityUrl;
};

/** @deprecated read `config.authUrl` — kept for same-origin hub call sites that snapshot at import. */
export const AUTH_URL = config.authUrl;
/** @deprecated read `config.socialUrl`. */
export const SOCIAL_URL = config.socialUrl;
