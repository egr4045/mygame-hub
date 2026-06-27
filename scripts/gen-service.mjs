#!/usr/bin/env node
/**
 * Service generator. Every backend module starts from the same skeleton so the isolation
 * contract is uniform: a /health endpoint, a production entry (`index.ts`, real adapters),
 * a standalone entry (`standalone.ts`, fake adapters from @mygame/test-harness), and a contract
 * test. Game logic and protocol messages are filled in per phase.
 *
 *   corepack pnpm gen:service <kebab-name>
 *
 * Then run `corepack pnpm install` to link the new workspace package.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: corepack pnpm gen:service <kebab-name>  (lowercase, kebab-case)');
  process.exit(1);
}

const dir = join(root, 'services', name);
if (existsSync(dir)) {
  console.error(`services/${name} already exists.`);
  process.exit(1);
}

const ENV = name.toUpperCase().replace(/-/g, '_');

const files = {
  'package.json':
    JSON.stringify(
      {
        name: `@mygame/${name}`,
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          'dev:standalone': 'tsx watch src/standalone.ts',
          start: 'tsx src/index.ts',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
          lint: 'eslint .',
          clean: 'rimraf .turbo *.tsbuildinfo',
        },
        dependencies: {
          '@mygame/protocol': 'workspace:*',
          '@mygame/shared-types': 'workspace:*',
        },
        devDependencies: {
          '@mygame/test-harness': 'workspace:*',
          '@types/node': '^22.10.2',
          tsx: '^4.19.2',
          typescript: '^5.7.2',
          vitest: '^2.1.8',
        },
      },
      null,
      2,
    ) + '\n',

  'tsconfig.json': `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src"]
}
`,

  'src/config.ts': `/** Environment-driven config for the ${name} service. */
export interface ServiceConfig {
  readonly service: string;
  readonly port: number;
  readonly env: string;
}

export const loadConfig = (): ServiceConfig => ({
  service: '${name}',
  port: Number(process.env.${ENV}_PORT ?? 8080),
  env: process.env.NODE_ENV ?? 'development',
});
`,

  'src/logger.ts': `import type { Logger } from '@mygame/shared-types';

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
`,

  'src/app.ts': `import { createServer, type Server } from 'node:http';
import type { Clock, Logger } from '@mygame/shared-types';

/**
 * Dependencies are injected as ports (clock/logger/...) so the same app runs against real
 * adapters in production and fakes in standalone/contract tests — the isolation contract.
 */
export interface AppDeps {
  readonly clock: Clock;
  readonly logger: Logger;
}

export const createApp = (deps: AppDeps): Server =>
  createServer((req, res) => {
    if (req.url === '/health' || req.url === '/ready') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: '${name}', now: deps.clock.now() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
`,

  'src/index.ts': `/** Production entry: real adapters (system clock, console logger). */
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service });
const app = createApp({ clock: { now: () => Date.now() }, logger });

app.listen(config.port, () => logger.info('listening', { port: config.port, mode: 'production' }));
`,

  'src/standalone.ts': `/**
 * Standalone entry: runs the service in isolation with fake adapters and no real
 * infrastructure. This is how the module is developed and contract-tested before integration.
 */
import { createFakeClock } from '@mygame/test-harness';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createConsoleLogger } from './logger.js';

const config = loadConfig();
const logger = createConsoleLogger({ svc: config.service, mode: 'standalone' });
const app = createApp({ clock: createFakeClock(0), logger });

app.listen(config.port, () =>
  logger.info('listening (standalone, fake adapters)', { port: config.port }),
);
`,

  'src/app.test.ts': `import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createFakeClock, createCapturingLogger } from '@mygame/test-harness';
import { createApp } from './app.js';

let server: ReturnType<typeof createApp> | undefined;
afterEach(() => server?.close());

const start = () => {
  server = createApp({ clock: createFakeClock(123), logger: createCapturingLogger() });
  return new Promise<number>((resolve) => {
    server!.listen(0, () => resolve((server!.address() as AddressInfo).port));
  });
};

describe('${name} app', () => {
  it('serves /health', async () => {
    const port = await start();
    const res = await fetch(\`http://127.0.0.1:\${port}/health\`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', service: '${name}', now: 123 });
  });

  it('404s unknown routes', async () => {
    const port = await start();
    const res = await fetch(\`http://127.0.0.1:\${port}/nope\`);
    expect(res.status).toBe(404);
  });
});
`,

  'README.md': `# @mygame/${name}

A CIVA backend service. Isolated module — talks to the outside only through \`@mygame/protocol\`.

\`\`\`sh
corepack pnpm --filter @mygame/${name} dev:standalone   # run in isolation (fake adapters)
corepack pnpm --filter @mygame/${name} test             # unit + contract tests
corepack pnpm --filter @mygame/${name} dev              # run with real adapters
\`\`\`

Port: \`${ENV}_PORT\` (default 8080).
`,
};

for (const [rel, content] of Object.entries(files)) {
  const target = join(dir, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

console.log(`Created services/${name}/`);
console.log('Next: corepack pnpm install');
