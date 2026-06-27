/**
 * Route a resolved invite into its game. Every game is its own SPA on its own origin: we wake the
 * game (orchestrator), mint a fresh SSO handoff token and redirect carrying the join code (`?join=`),
 * so the game resolves the rest. Shared by the `?invite=` deep link and the "Join" button on a
 * pushed invite, so both paths behave identically.
 */
import type { Invite } from '@civa/protocol';
import { GAMES } from './games.js';
import { enterGame } from '../net/orchestratorClient.js';
import { getHandoff } from '../net/authClient.js';

export const routeToInvite = async (inv: Invite): Promise<void> => {
  const game = GAMES.find((g) => g.id === inv.game);
  await enterGame(inv.game);
  const handoff = await getHandoff();
  if (game?.externalPort) {
    const params = new URLSearchParams();
    if (handoff) params.set('pt', handoff);
    params.set('join', inv.room);
    if (inv.role === 'spectator') params.set('spectate', '1');
    window.location.href = `${window.location.protocol}//${window.location.hostname}:${game.externalPort}/?${params.toString()}`;
  }
};
