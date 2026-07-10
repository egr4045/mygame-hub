import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Prod deploys this behind a path (mygame-quiz.ru/admin/) rather than a dedicated origin — same
  // path-based pattern as apps/example-game. Set at build time only (the Dockerfile's adminbuild
  // stage); dev serves from `/`.
  base: process.env.VITE_BASE_PATH ?? '/',
  server: {
    port: 5200,
    host: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Consume the SDK from source (HMR, no build step) — same pattern the hub/example-game use.
      '@mygame/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
    },
  },
});
