/**
 * The SDK's theme seam. Every SDK component styles itself with `mg.*` — CSS `var(--mg-*, fallback)`
 * strings whose fallback values are baked in from `@mygame/ui-kit` at build time (ui-kit is a
 * devDependency, so tsup bundles the VALUES; published dist and the IIFE stay self-contained).
 *
 * How theming resolves, by host:
 * - The hub defines `--mg-*` on `:root` (see apps/hub theme.ts) — its values win everywhere,
 *   including for widgets it renders directly in the document.
 * - An embedded game that does nothing gets the baked-in fallbacks — the stock GAMEHUB look.
 * - An embedded game MAY theme the overlay by defining `--mg-*` custom properties anywhere above
 *   the overlay host element (custom properties inherit through the shadow boundary). For that to
 *   work the SDK must NEVER define these vars on `:host` inside its shadow root — the fallback in
 *   `var()` is the only default. Keep it that way.
 */
import { color, radius, font, motion, shadow } from '@mygame/ui-kit';

const hexToRgba = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/**
 * The flat variable map: kebab-cased `--mg-*` names → default values. The single place fallbacks
 * live; components never hand-write hex or `var()` strings.
 */
export const MG_DEFAULTS = {
  // Surfaces.
  'mg-surface': color.panelSolid,
  'mg-surface-deep': color.panelDeep,
  'mg-surface-raised': color.panelHover,
  'mg-border': color.panelBorder,
  'mg-overlay': color.overlay,

  // Text.
  'mg-text': color.textPrimary,
  'mg-text-muted': color.textMuted,
  'mg-text-inverse': color.textInverse,

  // Semantics.
  'mg-accent': color.accent,
  'mg-accent-muted': color.accentMuted,
  /** Precomputed translucent accent for drop-target/selection washes (no color-mix — old WebViews). */
  'mg-accent-soft': hexToRgba(color.accent, 0.18),
  'mg-danger': color.negative,
  'mg-danger-soft': hexToRgba(color.negative, 0.15),
  'mg-positive': color.positive,
  'mg-positive-soft': hexToRgba(color.positive, 0.15),
  'mg-warning': color.warning,
  /** Achievement gold — a deliberate semantic of its own (toasts, profile title chip). */
  'mg-achievement': '#d4af37',

  // Call stage (kept darker than chat chrome; literals chosen to sit on the facelift ramp).
  'mg-stage': color.panelDeep,
  'mg-tile': '#161b26',
  'mg-tile-alt': '#11151e',

  // Chat specifics.
  'mg-bubble-out': color.accent,
  'mg-bubble-in': '#1e2432',
  'mg-row-hover': color.panelHover,
  'mg-unread': color.accent,

  // Radii (px strings so they drop straight into CSS).
  'mg-r-sm': `${radius.sm}px`,
  'mg-r-md': `${radius.md}px`,
  'mg-r-lg': `${radius.lg}px`,
  'mg-r-pill': `${radius.pill}px`,

  // Typography & motion.
  'mg-font': font.family,
  'mg-motion-fast': motion.fast,
  'mg-motion-base': motion.base,

  // Elevation.
  'mg-shadow-sm': shadow.sm,
  'mg-shadow-md': shadow.md,
  'mg-shadow-popover': shadow.popover,
  'mg-shadow-window': shadow.window,
} as const;

type MgVarName = keyof typeof MG_DEFAULTS;

const v = (name: MgVarName): string => `var(--${name}, ${MG_DEFAULTS[name]})`;

/** Ready-to-use CSS value strings, one per variable — what components actually reference. */
export const mg = {
  surface: v('mg-surface'),
  surfaceDeep: v('mg-surface-deep'),
  surfaceRaised: v('mg-surface-raised'),
  border: v('mg-border'),
  overlay: v('mg-overlay'),

  text: v('mg-text'),
  textMuted: v('mg-text-muted'),
  textInverse: v('mg-text-inverse'),

  accent: v('mg-accent'),
  accentMuted: v('mg-accent-muted'),
  accentSoft: v('mg-accent-soft'),
  danger: v('mg-danger'),
  dangerSoft: v('mg-danger-soft'),
  positive: v('mg-positive'),
  positiveSoft: v('mg-positive-soft'),
  warning: v('mg-warning'),
  achievement: v('mg-achievement'),

  stage: v('mg-stage'),
  tile: v('mg-tile'),
  tileAlt: v('mg-tile-alt'),

  bubbleOut: v('mg-bubble-out'),
  bubbleIn: v('mg-bubble-in'),
  rowHover: v('mg-row-hover'),
  unread: v('mg-unread'),

  rSm: v('mg-r-sm'),
  rMd: v('mg-r-md'),
  rLg: v('mg-r-lg'),
  rPill: v('mg-r-pill'),

  font: v('mg-font'),
  motionFast: v('mg-motion-fast'),
  motionBase: v('mg-motion-base'),

  shadowSm: v('mg-shadow-sm'),
  shadowMd: v('mg-shadow-md'),
  shadowPopover: v('mg-shadow-popover'),
  shadowWindow: v('mg-shadow-window'),
} as const;

/**
 * The SDK overlay's stacking ladder (previously scattered literals: 1000/1001/1600/9999/99999).
 * Toasts sit above everything; the call window above the chat window it can overlap.
 */
export const mgZ = {
  launcher: 1000,
  widget: 1000,
  panel: 1001,
  call: 1600,
  /** Blocking dialogs — above the call window, below menus that may open on top of them. */
  modal: 1700,
  menu: 9999,
  toast: 99999,
} as const;

/**
 * CSS text defining every `--mg-*` with its default value, for a host that wants to pin the theme
 * explicitly (the hub injects this on `:root` with ui-kit values). NOT injected inside the SDK's
 * own shadow root — see the module docstring.
 */
export const sdkThemeCss = (selector = ':root'): string =>
  `${selector} {\n${Object.entries(MG_DEFAULTS)
    .map(([k, val]) => `  --${k}: ${val};`)
    .join('\n')}\n}`;

/** Shared mobile breakpoint (px). Mirrors the hub's `useIsMobile` media query (max-width: 767px). */
export const MOBILE_BREAKPOINT = 768;

export { hexToRgba };
