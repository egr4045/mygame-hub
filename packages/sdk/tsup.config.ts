import { defineConfig } from 'tsup';

export default defineConfig([
  // npm package: ESM + CJS + type declarations. React is a peer dep — left external so the
  // consuming app provides the single React instance (the overlay shares it).
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: ['react', 'react-dom', 'react-dom/client'],
  },
  // <script> global: a self-contained IIFE exposing `window.mygame` (the client), with React
  // bundled in so a plain HTML game needs nothing else.
  {
    entry: { 'mygame-sdk': 'src/global.ts' },
    format: ['iife'],
    globalName: 'mygame',
    sourcemap: true,
    minify: true,
    // Unwrap the default export so `window.mygame` is the client itself (mygame.init(...)).
    footer: {
      js: 'window.mygame = (window.mygame && window.mygame.default) ? window.mygame.default : window.mygame;',
    },
  },
]);
