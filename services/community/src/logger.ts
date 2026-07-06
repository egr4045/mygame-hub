import type { Logger } from '@mygame/shared-types';

/** Tiny JSON console logger (real adapter). Swapped for pino in Phase 10. */
export const createConsoleLogger = (base: Record<string, unknown> = {}): Logger => {
  const at =
    (level: string) =>
    (msg: string, fields?: Record<string, unknown>): void => {
      const line = { level, msg, ...base, ...fields };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(line));
    };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (bindings) => createConsoleLogger({ ...base, ...bindings }),
  };
};
