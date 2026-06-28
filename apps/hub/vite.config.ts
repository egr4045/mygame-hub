import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    host: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // The hub consumes the SDK from source (HMR, no build step). The dist build (package.json
      // exports) is for external game repos that npm-install @mygame/sdk.
      '@mygame/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
    },
  },
});
