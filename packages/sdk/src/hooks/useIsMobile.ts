/**
 * The one mobile-breakpoint hook for SDK widgets and the hub shell (the hub's own
 * `apps/hub/src/platform/useIsMobile.ts` re-exports this). Media-query driven — reacts to real
 * viewport changes without a manual resize listener per component. The numeric constant lives in
 * theme/tokens.ts (`MOBILE_BREAKPOINT`, 768) next to the rest of the design language.
 */
import { useEffect, useState } from 'react';
import { MOBILE_BREAKPOINT } from '../theme/tokens.js';

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

export const isMobileViewport = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia(QUERY).matches;

export const useIsMobile = (): boolean => {
  const [mobile, setMobile] = useState(isMobileViewport);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent): void => setMobile(e.matches);
    // Older Safari only exposes the deprecated addListener/removeListener pair.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    setMobile(mq.matches); // resync in case it changed between initial state and effect
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return mobile;
};
