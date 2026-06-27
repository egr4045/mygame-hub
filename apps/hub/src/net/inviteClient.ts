/**
 * Resolve a join code to its target room/role. The code itself is the capability, so this is an
 * unauthenticated GET on the social service — usable straight from a `?invite=CODE` deep link before
 * any socket exists. Returns null if the code is unknown or expired.
 */
import type { Invite } from '@mygame/protocol';
import { SOCIAL_URL } from './config.js';

export const resolveInvite = async (code: string): Promise<Invite | null> => {
  try {
    const res = await fetch(`${SOCIAL_URL}/invite/${encodeURIComponent(code.trim())}`);
    if (!res.ok) return null;
    return ((await res.json()) as { invite: Invite }).invite;
  } catch {
    return null;
  }
};
