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
    // Browser target: без этого tsup собирает под platform:node — в бандл попадают
    // ссылки на process и require('fs'), из-за чего IIFE падает в браузере и window.mygame
    // не выставляется. platform:browser выбирает browser-поля зависимостей (без fs);
    // env определяет process.env.NODE_ENV на этапе сборки (нужно React и др.).
    platform: 'browser',
    env: { NODE_ENV: 'production' },
    sourcemap: true,
    minify: true,
    // Unwrap the default export so `window.mygame` is the client itself (mygame.init(...)).
    footer: {
      js: 'window.mygame = (window.mygame && window.mygame.default) ? window.mygame.default : window.mygame;',
    },
  },
]);
