/**
 * The one place SDK code reads the viewport. `visualViewport` (when present) tracks the *visible*
 * area — it shrinks for the mobile on-screen keyboard and browser chrome, which `innerHeight` does
 * not — so floating windows clamped against it can never hide under bars the user can't move.
 */
import { useEffect, useState } from 'react';

export type Viewport = { w: number; h: number; top: number; left: number };

export const getViewport = (): Viewport => {
  if (typeof window === 'undefined') return { w: 1024, h: 768, top: 0, left: 0 };
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) {
    return { w: vv.width, h: vv.height, top: vv.offsetTop, left: vv.offsetLeft };
  }
  return { w: window.innerWidth, h: window.innerHeight, top: 0, left: 0 };
};

/** Live viewport rect — re-renders on window resize and visualViewport resize/scroll. */
export const useViewport = (): Viewport => {
  const [vp, setVp] = useState<Viewport>(getViewport);
  useEffect(() => {
    const update = (): void => {
      setVp((prev) => {
        const next = getViewport();
        return prev.w === next.w && prev.h === next.h && prev.top === next.top && prev.left === next.left ? prev : next;
      });
    };
    window.addEventListener('resize', update);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, []);
  return vp;
};
