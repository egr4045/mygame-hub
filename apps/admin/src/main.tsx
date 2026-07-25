import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted Inter Variable (latin + cyrillic subsets via unicode-range) — the ui-kit `font.family`
// token names 'Inter Variable' first; without this import it silently falls back to system fonts.
import '@fontsource-variable/inter';
import './index.css';
import { App } from './App.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
