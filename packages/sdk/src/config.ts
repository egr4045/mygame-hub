/**
 * Endpoints for the platform services (auth + social). In dev they run on their own ports; in prod
 * the hub serves them same-origin behind the gateway, so one build works on a raw port or a
 * subdomain — no rebuild per environment. Games will be able to override these explicitly via
 * `mygame.init({ hubUrl })` in Phase 2 step 2.
 *
 * `import.meta` is read defensively (cast) so the SDK stays framework-agnostic — it carries no
 * bundler-specific ambient types and must also work outside Vite.
 */
const sameOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
const env = meta.env ?? {};

export const AUTH_URL = env.VITE_AUTH_URL ?? (env.DEV ? 'http://localhost:8081' : sameOrigin);
export const SOCIAL_URL = env.VITE_SOCIAL_URL ?? (env.DEV ? 'http://localhost:8083' : sameOrigin);
