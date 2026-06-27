import type { Logger } from '@mygame/shared-types';

/** Tiny JSON console logger (real adapter). */
export const createConsoleLogger = (base: Record<string, unknown> = {}): Logger => {
  const at =
    (level: string) =>
    (msg: string, fields?: Record<string, unknown>): void => {
      console.log(JSON.stringify({ level, msg, ...base, ...fields }));
    };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (bindings) => createConsoleLogger({ ...base, ...bindings }),
  };
};
