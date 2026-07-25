import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted Inter Variable (latin + cyrillic subsets via unicode-range) — the ui-kit `font.family`
// token names 'Inter Variable' first; without this import it silently falls back to system fonts.
import '@fontsource-variable/inter';
import './styles/global.css';
import { injectTheme } from './theme.js';
import { App } from './App.js';

injectTheme();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
