/**
 * @mygame/ui-kit/tokens — the design language for the whole client.
 *
 * The UI is a fixed 100vw/100vh screen: a PixiJS map fills the background and translucent
 * React panels float over it (section 8). These tokens keep every panel, button and overlay
 * visually consistent. They are framework-agnostic plain values; Phase 1 wires them into CSS
 * variables and React components.
 */

export const color = {
  // Translucent panel surfaces over the map (Paradox-style).
  // 2026-07 facelift: deeper near-black base with a cooler cast, subtler borders, electric accent —
  // semantic names are stable, only the values moved (SDK --mg-* fallbacks derive from these).
  panel: 'rgba(15, 18, 26, 0.85)',
  panelSolid: '#0f1219',
  /** The darkest chrome layer: nav bars, page headers, input wells (below panelSolid). */
  panelDeep: '#0a0d14',
  panelBorder: 'rgba(140, 165, 210, 0.16)',
  panelHover: 'rgba(30, 37, 52, 0.92)',
  /** Modal scrims. */
  overlay: 'rgba(4, 6, 10, 0.72)',

  // Text.
  textPrimary: '#eef2f9',
  textMuted: '#98a4b8',
  textInverse: '#0b0f16',

  // Accents.
  accent: '#4c9aff',
  accentMuted: '#2f7fe0',

  // Resource semantics (used by the top resource bar + tooltips).
  food: '#7fc97f',
  wood: '#b07b4f',
  ore: '#9aa3ad',
  oil: '#3a3a44',
  electricity: '#f2c744',
  fuel: '#d96c3b',
  ammo: '#c0563f',
  electronics: '#5bd1c0',
  money: '#e8c24a',
  science: '#7c6cf0',
  population: '#e0a3c0',

  // States.
  positive: '#3fce7a',
  negative: '#ef5350',
  warning: '#f0a93c',
  // Diplomacy / combat feed.
  aggression: '#ef5350',
  diplomacy: '#4c9aff',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 40,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 14,
  pill: 999,
} as const;

export const font = {
  // 'Inter Variable' is the family name registered by @fontsource-variable/inter (self-hosted by
  // the hub and admin apps); everything after it is the graceful fallback stack for surfaces that
  // don't load webfonts (e.g. SDK widgets inside embedded games).
  family: "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  size: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 34 },
  weight: { regular: 400, medium: 500, bold: 700 },
} as const;

/** Elevation scale — one shadow language for every floating surface (panels, windows, popovers). */
export const shadow = {
  sm: '0 2px 8px rgba(0, 0, 0, 0.35)',
  md: '0 6px 20px rgba(0, 0, 0, 0.45)',
  popover: '0 10px 28px rgba(0, 0, 0, 0.5)',
  window: '0 16px 48px rgba(0, 0, 0, 0.55)',
} as const;

/** Stacking order for the overlay layers above the Canvas (section 8). */
export const zIndex = {
  map: 0,
  mapOverlay: 10,
  panels: 100,
  diplomacyWidget: 200,
  notifications: 300,
  modal: 400,
  assembly: 500,
  toast: 600,
} as const;

export const motion = {
  fast: '120ms ease-out',
  base: '200ms ease-out',
  slow: '360ms ease-in-out',
  phaseTransition: '600ms ease-in-out',
} as const;
