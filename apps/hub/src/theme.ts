/**
 * Bridges the framework-agnostic design tokens in @mygame/ui-kit into CSS custom properties so
 * both inline styles and global CSS read from one source of truth. Called once at startup.
 * Also pins the SDK's `--mg-*` theme vars to the same token values and injects the SDK's shared
 * CSS (fade-in/hover/markdown) — the hub renders the SDK widgets outside their shadow overlay.
 */
import { color, space, radius, font, motion, shadow } from '@mygame/ui-kit';
import { sdkThemeCss, SDK_OVERLAY_CSS } from '@mygame/sdk';

const toVars = (prefix: string, obj: Record<string, string | number>, unit = ''): string =>
  Object.entries(obj)
    .map(([k, v]) => `  --${prefix}-${kebab(k)}: ${typeof v === 'number' ? v + unit : v};`)
    .join('\n');

const kebab = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

export const injectTheme = (): void => {
  const css = `:root {
${toVars('c', color)}
${toVars('s', space, 'px')}
${toVars('r', radius, 'px')}
${toVars('sh', shadow)}
  --font-family: ${font.family};
  --font-mono: ${font.mono};
${toVars('fs', font.size, 'px')}
  --motion-fast: ${motion.fast};
  --motion-base: ${motion.base};
  --motion-slow: ${motion.slow};
  --motion-phase: ${motion.phaseTransition};
}

${sdkThemeCss(':root')}

${SDK_OVERLAY_CSS}`;
  const style = document.createElement('style');
  style.id = 'gamehub-theme';
  style.textContent = css;
  document.head.appendChild(style);
};
