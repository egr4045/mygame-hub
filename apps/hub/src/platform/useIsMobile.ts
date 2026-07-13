/**
 * Reactive phone-width detector. `true` while the viewport matches `(max-width: 767px)`, updated
 * live via a `matchMedia` listener (so a rotate/resize flips the hub between its desktop and mobile
 * shells without a reload). SSR-safe: defaults to `false` when `window` is unavailable.
 */
import { useEffect, useState } from 'react';

const QUERY = '(max-width: 767px)';

export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent): void => setIsMobile(e.matches);
    // Older Safari only exposes the deprecated addListener/removeListener pair.
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    setIsMobile(mql.matches); // resync in case it changed between initial state and effect
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  return isMobile;
};
