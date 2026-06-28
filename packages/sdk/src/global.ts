/**
 * UMD / `<script>` entry. Exposes the client as the global `window.mygame`, so a plain HTML game can
 * do `mygame.init('game', { hubUrl })` without a bundler. (The tsup `footer` unwraps the default
 * export onto `window.mygame`.)
 */
import { mygame } from './client.js';

export default mygame;
