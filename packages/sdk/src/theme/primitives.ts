/**
 * Shared inline-style building blocks for SDK components — the small set of shapes every widget
 * repeats (buttons, inputs, window shells, count badges). Built on `mg` so they follow the host
 * theme, with baked-in fallbacks for bare embedded-game overlays. Components spread these and
 * override only what's specific; do not re-declare these shapes per file.
 */
import type { CSSProperties } from 'react';
import { mg } from './tokens.js';

export type BtnVariant = 'primary' | 'neutral' | 'danger' | 'ghost';

/** Small action button (header actions, panel CTAs). Pill-shaped per the facelift language. */
export const btn = (variant: BtnVariant = 'neutral'): CSSProperties => {
  const base: CSSProperties = {
    border: '1px solid transparent',
    borderRadius: mg.rPill,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: mg.font,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    transition: `background ${mg.motionFast}, border-color ${mg.motionFast}, opacity ${mg.motionFast}`,
    userSelect: 'none',
  };
  switch (variant) {
    case 'primary':
      return { ...base, background: mg.accent, color: '#fff' };
    case 'danger':
      return { ...base, background: 'transparent', border: `1px solid ${mg.danger}`, color: mg.danger };
    case 'ghost':
      return { ...base, background: 'transparent', color: mg.textMuted };
    default:
      return { ...base, background: mg.surfaceRaised, border: `1px solid ${mg.border}`, color: mg.text };
  }
};

/** Round icon-only button (window headers, composer). */
export const iconBtn = (size = 36): CSSProperties => ({
  width: size,
  height: size,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: mg.textMuted,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: Math.round(size * 0.45),
  flex: '0 0 auto',
  transition: `background ${mg.motionFast}, color ${mg.motionFast}`,
});

/** Text input / textarea. */
export const input: CSSProperties = {
  background: mg.surfaceDeep,
  border: `1px solid ${mg.border}`,
  borderRadius: mg.rSm,
  padding: '8px 12px',
  color: mg.text,
  fontSize: 13,
  fontFamily: mg.font,
  outline: 'none',
};

/** Floating window / popover shell (chat window, friends panel, profile modal, call dock). */
export const surfaceWindow: CSSProperties = {
  background: mg.surface,
  border: `1px solid ${mg.border}`,
  borderRadius: mg.rLg,
  boxShadow: mg.shadowWindow,
  color: mg.text,
  fontFamily: mg.font,
  overflow: 'hidden',
};

/** Pill counter badge (unread counts, online counts). */
export const countBadge = (tone: 'accent' | 'positive' | 'danger' = 'accent'): CSSProperties => ({
  background: tone === 'accent' ? mg.accent : tone === 'positive' ? mg.positive : mg.danger,
  color: '#fff',
  fontSize: 11,
  fontWeight: 800,
  lineHeight: 1,
  padding: '3px 7px',
  borderRadius: mg.rPill,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
});
