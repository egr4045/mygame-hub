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
  panel: 'rgba(14, 20, 30, 0.82)',
  panelSolid: '#0e141e',
  /** The darkest chrome layer: nav bars, page headers, input wells (below panelSolid). */
  panelDeep: '#0a0f16',
  panelBorder: 'rgba(120, 150, 190, 0.25)',
  panelHover: 'rgba(26, 36, 52, 0.9)',
  /** Modal scrims. */
  overlay: 'rgba(0, 0, 0, 0.65)',

  // Text.
  textPrimary: '#e8eef6',
  textMuted: '#9aa9bd',
  textInverse: '#0b0f16',

  // Accents.
  accent: '#3da9fc',
  accentMuted: '#2b6cb0',

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
  positive: '#46c46a',
  negative: '#e0524a',
  warning: '#e8a13a',
  // Diplomacy / combat feed.
  aggression: '#e0524a',
  diplomacy: '#3da9fc',
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
  family: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  size: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 34 },
  weight: { regular: 400, medium: 500, bold: 700 },
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
