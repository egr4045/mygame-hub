/**
 * Re-export of the SDK's shared mobile-breakpoint hook — one 768px constant for the whole client
 * (packages/sdk/src/hooks/useIsMobile.ts + MOBILE_BREAKPOINT in the SDK theme tokens). Kept at this
 * path so existing hub imports stay stable.
 */
export { useIsMobile, isMobileViewport } from '@mygame/sdk';
