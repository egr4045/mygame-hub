/**
 * @mygame/auth-core — pure, stateless JWT sign/verify (HS256 via jose). The auth service issues
 * tokens; the lobby (and later services) verify them with the same shared secret. No I/O, no
 * account storage — that lives in the auth service. Stateless verification is what lets any
 * service authenticate a connection without calling back to auth.
 */
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { AuthClaims } from '@mygame/protocol';

export interface AuthConfig {
  secret: string;
  issuer: string;
  /** jose time strings, e.g. '15m', '30d'. */
  accessTtl: string;
  refreshTtl: string;
  /** Short-lived handoff token TTL (defaults to '120s'). */
  handoffTtl?: string;
}

export class TokenError extends Error {
  constructor(
    message: string,
    readonly reason: 'expired' | 'invalid',
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface AuthCore {
  signAccess(sub: string, name: string): Promise<string>;
  signRefresh(sub: string, name: string): Promise<string>;
  /** Short-lived token to carry identity to another game (URL `?pt=` / QR). */
  signHandoff(sub: string, name: string): Promise<string>;
  /** Throws TokenError on an expired/invalid token. */
  verify(token: string): Promise<AuthClaims>;
}

const asTyp = (raw: unknown): AuthClaims['typ'] =>
  raw === 'refresh' ? 'refresh' : raw === 'handoff' ? 'handoff' : 'access';

export const createAuthCore = (cfg: AuthConfig): AuthCore => {
  const key = new TextEncoder().encode(cfg.secret);

  const sign = (sub: string, name: string, typ: AuthClaims['typ'], ttl: string): Promise<string> =>
    new SignJWT({ name, typ })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer(cfg.issuer)
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(key);

  return {
    signAccess: (sub, name) => sign(sub, name, 'access', cfg.accessTtl),
    signRefresh: (sub, name) => sign(sub, name, 'refresh', cfg.refreshTtl),
    signHandoff: (sub, name) => sign(sub, name, 'handoff', cfg.handoffTtl ?? '120s'),
    verify: async (token) => {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: cfg.issuer });
        return { sub: String(payload.sub ?? ''), name: String(payload.name ?? ''), typ: asTyp(payload.typ) };
      } catch (err) {
        if (err instanceof joseErrors.JWTExpired) throw new TokenError('token expired', 'expired');
        throw new TokenError('invalid token', 'invalid');
      }
    },
  };
};
