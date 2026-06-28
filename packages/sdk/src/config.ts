/**
 * Runtime configuration for the platform services (auth + social) the SDK talks to.
 *
 * Defaults: dev → localhost ports; prod → same origin (the hub serves the services behind its
 * gateway, so one build works on a raw port or a subdomain). A game embedding the SDK points it at
 * the hub with `mygame.init(id, { hubUrl })`, which calls `configure()` below before any request.
 *
 * `import.meta` is read defensively (cast) so the SDK carries no bundler-specific ambient types and
 * also runs outside Vite.
 */
const sameOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
const env = meta.env ?? {};

export interface PlatformConfig {
  authUrl: string;
  socialUrl: string;
}

export const config: PlatformConfig = {
  authUrl: env.VITE_AUTH_URL ?? (env.DEV ? 'http://localhost:8081' : sameOrigin),
  socialUrl: env.VITE_SOCIAL_URL ?? (env.DEV ? 'http://localhost:8083' : sameOrigin),
};

export interface ConfigureOptions {
  /** Base URL of the hub; sets both auth and social unless one is overridden below. */
  hubUrl?: string;
  authUrl?: string;
  socialUrl?: string;
}

/** Point the SDK at a hub. Called by `mygame.init`; safe to call again to re-point. */
export const configure = (opts: ConfigureOptions): void => {
  if (opts.hubUrl !== undefined) {
    config.authUrl = opts.hubUrl;
    config.socialUrl = opts.hubUrl;
  }
  if (opts.authUrl !== undefined) config.authUrl = opts.authUrl;
  if (opts.socialUrl !== undefined) config.socialUrl = opts.socialUrl;
};

/** @deprecated read `config.authUrl` — kept for same-origin hub call sites that snapshot at import. */
export const AUTH_URL = config.authUrl;
/** @deprecated read `config.socialUrl`. */
export const SOCIAL_URL = config.socialUrl;
