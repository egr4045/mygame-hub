import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    host: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Consume the SDK from source (HMR, no build step) — same pattern the hub uses. A real game
      // installed from npm would instead get this via its normal dependency resolution.
      '@mygame/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
    },
  },
});
