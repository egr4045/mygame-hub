import { randomBytes } from 'node:crypto';
import type { InviteRole } from '@mygame/protocol';

/**
 * Invite store port: opaque, expiring join codes. A code is a capability — unforgeable because it is
 * random (no signing needed) — that resolves to a room + role. In-memory adapter for dev/tests; a
 * Postgres adapter (platform-db) swaps in for durability without touching the service logic.
 */
export interface InviteRecord {
  code: string;
  game: string;
  gameName: string;
  room: string;
  role: InviteRole;
  inviter: string;
  inviterName: string;
  expiresAt: number;
}

export type InviteInput = Omit<InviteRecord, 'code' | 'expiresAt'>;

export interface InviteStore {
  create(input: InviteInput): InviteRecord;
  /** Returns the record, or undefined if unknown/expired. */
  resolve(code: string): InviteRecord | undefined;
}

// Unambiguous alphabet (no 0/O/1/I): 32 chars so a byte maps cleanly via `& 31`.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = (len = 6): string => {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! & 31];
  return out;
};

export interface InviteStoreOptions {
  /** Code lifetime in ms (default 1h). */
  ttlMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export const createMemoryInviteStore = (opts: InviteStoreOptions = {}): InviteStore => {
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());
  const codes = new Map<string, InviteRecord>();

  return {
    create(input) {
      let code = makeCode();
      while (codes.has(code)) code = makeCode();
      const record: InviteRecord = { ...input, code, expiresAt: now() + ttlMs };
      codes.set(code, record);
      return record;
    },
    resolve(code) {
      const record = codes.get(code);
      if (!record) return undefined;
      if (record.expiresAt <= now()) {
        codes.delete(code);
        return undefined;
      }
      return record;
    },
  };
};
