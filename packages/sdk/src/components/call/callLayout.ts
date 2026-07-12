/** Pure layout helpers for the call stage. No React, no LiveKit — just math, so they're trivially
 *  testable and shared between grid and filmstrip rendering. */

/** Square-ish grid: columns = ceil(sqrt(n)), which reads better than a fixed 2-up for 3, 5–9 tiles.
 *  Capped so a big group doesn't produce hair-thin columns. */
export const gridColumns = (count: number): number => {
  if (count <= 1) return 1;
  const cols = Math.ceil(Math.sqrt(count));
  return Math.min(cols, 4);
};

/** Two-letter initials for the avatar fallback when a participant has no camera track. */
export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
};

/** Deterministic tile-background hue from an identity, so avatar-only tiles aren't all the same grey. */
export const avatarColor = (identity: string): string => {
  let hash = 0;
  for (let i = 0; i < identity.length; i++) hash = (hash * 31 + identity.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 32%)`;
};
