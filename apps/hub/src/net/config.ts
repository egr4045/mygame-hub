/**
 * Endpoints for the auth + lobby services.
 *
 * - Dev: the services run on their own ports (8081/8082), so default to localhost there.
 * - Prod: the app is served behind a reverse proxy that routes `/auth/*` and `/socket.io/*` to the
 *   services on the SAME origin, so default to the page origin. This means one build works whether
 *   it's exposed on a raw port or a subdomain — no rebuild per environment.
 *
 * Override explicitly with VITE_AUTH_URL / VITE_LOBBY_URL when needed.
 */
const sameOrigin = typeof window !== 'undefined' ? window.location.origin : '';

export const AUTH_URL =
  (import.meta.env.VITE_AUTH_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:8081' : sameOrigin);

export const LOBBY_URL =
  (import.meta.env.VITE_LOBBY_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:8082' : sameOrigin);

/** Social service (friends + presence). Same-origin in prod via the gateway; localhost in dev. */
export const SOCIAL_URL =
  (import.meta.env.VITE_SOCIAL_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:8083' : sameOrigin);
