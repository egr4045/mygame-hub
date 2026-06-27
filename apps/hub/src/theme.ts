/**
 * Bridges the framework-agnostic design tokens in @mygame/ui-kit into CSS custom properties so
 * both inline styles and global CSS read from one source of truth. Called once at startup.
 */
import { color, space, radius, font, motion } from '@mygame/ui-kit';

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
  --font-family: ${font.family};
  --font-mono: ${font.mono};
${toVars('fs', font.size, 'px')}
  --motion-fast: ${motion.fast};
  --motion-base: ${motion.base};
  --motion-slow: ${motion.slow};
  --motion-phase: ${motion.phaseTransition};
}`;
  const style = document.createElement('style');
  style.id = 'civa-theme';
  style.textContent = css;
  document.head.appendChild(style);
};
