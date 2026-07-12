/**
 * Shared inline-style constants for the call UI. Not a CSS-in-JS layer — just exported style
 * objects so the call components stay DRY while keeping the repo's inline-styles ethos. The only
 * global CSS the call needs is the speaking-pulse `@keyframes`, injected alongside `.civa-fade-in`
 * in `overlay/mount.tsx` (shadow-DOM path) and the hub's `global.css` (direct-mount path).
 */
import type { CSSProperties } from 'react';

export const palette = {
  /** deep near-black call backdrop (darker than the chat window for a "stage" feel) */
  stage: '#0e1116',
  tileBg: '#1a1f29',
  tileBgAlt: '#12161d',
  panel: 'rgba(17,20,27,0.92)',
  border: '#3d4450',
  accent: '#5c7e10',
  /** Discord-green active-speaker highlight */
  speaking: '#3ba55d',
  danger: '#ed4245',
  text: '#dcdedf',
  subtle: '#8f98a0',
  blue: '#2AABEE',
} as const;

/** A round control button (mic / cam / screen / leave). `variant` sets the resting fill. */
export const controlButton = (variant: 'neutral' | 'active' | 'danger' = 'neutral'): CSSProperties => ({
  background: variant === 'danger' ? palette.danger : variant === 'active' ? palette.accent : palette.border,
  border: 'none',
  width: 48,
  height: 48,
  borderRadius: '50%',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 120ms ease, transform 80ms ease',
  flexShrink: 0,
});

/** Small square icon button used for expand / fullscreen / minimize in the top bar. */
export const chromeButton: CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: 'none',
  width: 34,
  height: 34,
  borderRadius: 8,
  color: palette.text,
  cursor: 'pointer',
  fontSize: 15,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export const tileBase: CSSProperties = {
  position: 'relative',
  background: palette.tileBg,
  borderRadius: 10,
  overflow: 'hidden',
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export const coverVideo: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
export const containVideo: CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };
