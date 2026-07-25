/**
 * The library "Play" flow, shared by the desktop hub and the mobile shell so neither reimplements
 * it: record the launch, wake the game (orchestrator), mint a one-time SSO handoff and navigate to
 * the game's own origin carrying it (`?pt=`). Games with neither `path` nor `externalPort` configured
 * have no origin to open — the legacy `onNoOrigin` fallback (desktop's `selectGame`) handles those.
 *
 * If the player is in a call, the call key rides along as `?call=` so the game's `resume()` rejoins
 * the very same LiveKit room — the party keeps talking across the navigation. Without it the carry-in
 * would depend on the game sharing our origin (localStorage `gamehub.activeCall`), which is only true
 * for `path`-routed games in prod, not for `externalPort` ones or local dev.
 */
import type { GameInfo } from './games.js';
import { getGameOrigin } from './games.js';
import { enterGame } from '../net/orchestratorClient.js';
import { getHandoff, recordGameEnter, useCallStore } from '@mygame/sdk';

export const enterAndPlayGame = (game: GameInfo, onNoOrigin?: (gameId: string) => void): void => {
  void recordGameEnter(game.id); // best-effort; a failed write just means stale "last played"
  const base = getGameOrigin(game);
  if (!base) {
    onNoOrigin?.(game.id);
    return;
  }
  void (async () => {
    await enterGame(game.id);
    const handoff = await getHandoff();
    const url = new URL(`${base}/`);
    if (handoff) url.searchParams.set('pt', handoff);
    const { callKey, status } = useCallStore.getState();
    if (callKey && status !== 'idle') url.searchParams.set('call', callKey);
    window.location.href = url.toString();
  })();
};
