/**
 * The single drag/position engine for every floating SDK surface (chat window, social launcher,
 * call dock). Replaces three hand-rolled mouse-only implementations with one pointer-based hook:
 * mouse + touch + pen, viewport clamping via `visualViewport`, anchored persistence, and one-time
 * migration of the legacy localStorage formats.
 *
 * Anchoring: `bottom-right` stores offsets from the bottom-right viewport corner, so a launcher
 * parked "24px above the bottom edge" stays exactly there on ANY window size — the durable fix for
 * "the Windows taskbar hides the button" (the old code pinned an absolute `top` that never
 * revalidated). `top-left` stores plain coordinates (windows). Either way the position is clamped
 * against the *current* viewport on every load and every viewport change, so a stale stored value
 * can never strand a widget off-screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { getViewport, useViewport, type Viewport } from './useViewport.js';
import { loadJson, saveJson, removeKey } from '../utils/storage.js';

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Anchor = 'top-left' | 'bottom-right';

/** Persisted shape, keyed `mygame.ui.win.<key>`. `a`/`b` are x/y (top-left) or right/bottom offsets. */
type StoredV2 = { v: 2; anchor: Anchor; a: number; b: number };

const STORE_PREFIX = 'mygame.ui.win.';
/** Movement below this many px counts as a click, not a drag (protects launcher toggle taps). */
const DRAG_THRESHOLD = 4;

const clampPos = (p: Point, size: Size, vp: Viewport, minVisible: number, margin: number): Point => ({
  // Horizontally the window may hang off-screen as long as `minVisible` px of it stays reachable.
  x: Math.max(margin - Math.max(0, size.w - minVisible), Math.min(p.x, vp.w - minVisible)),
  // Vertically the grab handle lives at the top — never let it leave [margin, bottom - minVisible].
  y: Math.max(margin, Math.min(p.y, vp.h - minVisible)),
});

const toAnchored = (p: Point, anchor: Anchor, size: Size, vp: Viewport): { a: number; b: number } =>
  anchor === 'bottom-right' ? { a: vp.w - p.x - size.w, b: vp.h - p.y - size.h } : { a: p.x, b: p.y };

const fromAnchored = (s: { a: number; b: number }, anchor: Anchor, size: Size, vp: Viewport): Point =>
  anchor === 'bottom-right' ? { x: vp.w - s.a - size.w, y: vp.h - s.b - size.h } : { x: s.a, y: s.b };

export interface FloatingWindowOptions {
  /** Persist under `mygame.ui.win.<key>`; omit for an ephemeral (per-mount) position. */
  key?: string;
  anchor: Anchor;
  /** Default position for first run (receives the live viewport and current size). */
  defaultPos: (vp: Viewport, size: Size) => Point;
  /** Current rendered size, for clamping and anchor math. A getter so live sizes stay fresh. */
  size: Size | (() => Size);
  /** px of the drag handle that must remain on-screen. */
  minVisible?: number;
  margin?: number;
  /** Fullscreen/mobile mode — drag becomes a no-op (handleProps turn inert). */
  disabled?: boolean;
  /** Legacy top-left `{x,y}` localStorage key to migrate from (removed after first successful read). */
  legacyKey?: string;
}

export interface FloatingWindowApi {
  /** Resolved top-left position in viewport coordinates (already clamped). */
  pos: Point;
  dragging: boolean;
  /** True from the moment a press travels past the drag threshold until the NEXT press. */
  moved: React.MutableRefObject<boolean>;
  /** Spread onto the drag handle element(s). Inner interactive elements stay clickable. */
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
  setPos: (p: Point) => void;
  resetPos: () => void;
}

export const useFloatingWindow = (opts: FloatingWindowOptions): FloatingWindowApi => {
  const { key, anchor, minVisible = 48, margin = 8, disabled = false } = opts;
  const vp = useViewport();

  const getSize = (): Size => (typeof opts.size === 'function' ? opts.size() : opts.size);
  const getSizeRef = useRef(getSize);
  getSizeRef.current = getSize;
  const defaultPosRef = useRef(opts.defaultPos);
  defaultPosRef.current = opts.defaultPos;

  // Source of truth is the ANCHORED pair — for bottom-right that's what makes the position track
  // the bottom edge across window resizes instead of clamping a stale top-left point.
  const [stored, setStored] = useState<{ a: number; b: number }>(() => {
    const vp0 = getViewport();
    const size0 = getSizeRef.current();
    if (key) {
      const v2 = loadJson<StoredV2 | null>(STORE_PREFIX + key, null);
      if (v2 && v2.v === 2 && v2.anchor === anchor && Number.isFinite(v2.a) && Number.isFinite(v2.b)) {
        return { a: v2.a, b: v2.b };
      }
      if (opts.legacyKey) {
        const legacy = loadJson<Point | null>(opts.legacyKey, null);
        if (legacy && Number.isFinite(legacy.x) && Number.isFinite(legacy.y)) {
          removeKey(opts.legacyKey);
          const migrated = toAnchored(clampPos(legacy, size0, vp0, minVisible, margin), anchor, size0, vp0);
          saveJson(STORE_PREFIX + key, { v: 2, anchor, ...migrated } satisfies StoredV2);
          return migrated;
        }
      }
    }
    return toAnchored(clampPos(defaultPosRef.current(vp0, size0), size0, vp0, minVisible, margin), anchor, size0, vp0);
  });

  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);

  // Render position: derived, re-clamped against the LIVE viewport every render/resize.
  const size = getSize();
  const pos = useMemo(
    () => clampPos(fromAnchored(stored, anchor, size, vp), size, vp, minVisible, margin),
    [stored, anchor, size.w, size.h, vp, minVisible, margin],
  );

  const commit = (p: Point, save: boolean): void => {
    const vpNow = getViewport();
    const sizeNow = getSizeRef.current();
    const next = toAnchored(clampPos(p, sizeNow, vpNow, minVisible, margin), anchor, sizeNow, vpNow);
    setStored(next);
    if (save && key) saveJson(STORE_PREFIX + key, { v: 2, anchor, ...next } satisfies StoredV2);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    if (disabled || e.button !== 0) return;
    // Presses on interactive children start THEIR action, not a drag — unless the handle itself is
    // the interactive element (the launcher is a <button>).
    const hit = (e.target as HTMLElement).closest('button, input, a, textarea, select, [data-nodrag]');
    if (hit && hit !== e.currentTarget) return;

    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = pos;
    moved.current = false;
    let draggingNow = false;

    const onMove = (ev: globalThis.PointerEvent): void => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!draggingNow && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!draggingNow) {
        draggingNow = true;
        moved.current = true;
        setDragging(true);
      }
      commit({ x: origin.x + dx, y: origin.y + dy }, false);
    };
    const onUp = (): void => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (draggingNow) {
        setDragging(false);
        // Re-save through commit so the final clamped value is what persists.
        setStored((s) => {
          if (key) saveJson(STORE_PREFIX + key, { v: 2, anchor, ...s } satisfies StoredV2);
          return s;
        });
      }
    };

    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported — plain listeners still work while the pointer stays over the element */
    }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  return {
    pos,
    dragging,
    moved,
    handleProps: {
      onPointerDown,
      style: disabled
        ? {}
        : { touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' },
    },
    setPos: (p) => commit(p, true),
    resetPos: () => {
      const vpNow = getViewport();
      const sizeNow = getSizeRef.current();
      commit(defaultPosRef.current(vpNow, sizeNow), true);
      if (key) removeKey(STORE_PREFIX + key);
    },
  };
};

/* ------------------------------------------------------------------------------------------------
 * Resize handle — the visible, touch-capable replacement for CSS `resize: both` (whose native grip
 * is invisible on dark surfaces and mouse-only).
 * ---------------------------------------------------------------------------------------------- */

export interface ResizeHandleOptions {
  /** Persist under `mygame.ui.size.<key>`; also the migration target for `legacyKey`. */
  key?: string;
  legacyKey?: string;
  min: Size;
  size: Size;
  onChange: (s: Size) => void;
  disabled?: boolean;
}

const SIZE_PREFIX = 'mygame.ui.size.';

export const clampSizeTo = (s: Size, min: Size, vp: Viewport): Size => ({
  w: Math.min(Math.max(min.w, s.w), vp.w),
  h: Math.min(Math.max(min.h, s.h), vp.h),
});

/** Load a persisted size (v2 or legacy `{w,h}`), clamped; use from a lazy useState initializer. */
export const loadStoredSize = (key: string, legacyKey: string | undefined, fallback: Size, min: Size): Size => {
  const vp = getViewport();
  const v2 = loadJson<Size | null>(SIZE_PREFIX + key, null);
  if (v2 && Number.isFinite(v2.w) && Number.isFinite(v2.h)) return clampSizeTo(v2, min, vp);
  if (legacyKey) {
    const legacy = loadJson<Size | null>(legacyKey, null);
    if (legacy && Number.isFinite(legacy.w) && Number.isFinite(legacy.h)) {
      removeKey(legacyKey);
      const migrated = clampSizeTo(legacy, min, vp);
      saveJson(SIZE_PREFIX + key, migrated);
      return migrated;
    }
  }
  return clampSizeTo(fallback, min, vp);
};

export const useResizeHandle = (opts: ResizeHandleOptions): {
  resizing: boolean;
  handleProps: { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void; style: CSSProperties };
} => {
  const [resizing, setResizing] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    if (optsRef.current.disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = optsRef.current.size;
    // Latest size lives in this closure, NOT in optsRef — React may not have re-rendered between
    // the last move and the pointerup, so reading state there could persist a stale value.
    let latest = start;
    setResizing(true);

    const onMove = (ev: globalThis.PointerEvent): void => {
      latest = clampSizeTo(
        { w: start.w + (ev.clientX - startX), h: start.h + (ev.clientY - startY) },
        optsRef.current.min,
        getViewport(),
      );
      optsRef.current.onChange(latest);
    };
    const onUp = (): void => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      setResizing(false);
      const { key } = optsRef.current;
      if (key) saveJson(SIZE_PREFIX + key, latest);
    };

    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ok */
    }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  return {
    resizing,
    handleProps: { onPointerDown, style: { touchAction: 'none', cursor: 'nwse-resize' } },
  };
};
