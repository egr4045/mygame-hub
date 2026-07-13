/**
 * The library "Play" flow, shared by the desktop hub and the mobile shell so neither reimplements
 * it: record the launch, wake the game (orchestrator), mint a one-time SSO handoff and navigate to
 * the game's own origin carrying it (`?pt=`). Games with neither `path` nor `externalPort` configured
 * have no origin to open — the legacy `onNoOrigin` fallback (desktop's `selectGame`) handles those.
 */
import type { GameInfo } from './games.js';
import { getGameOrigin } from './games.js';
import { enterGame } from '../net/orchestratorClient.js';
import { getHandoff, recordGameEnter } from '@mygame/sdk';

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
    window.location.href = handoff ? `${base}/?pt=${encodeURIComponent(handoff)}` : base;
  })();
};
