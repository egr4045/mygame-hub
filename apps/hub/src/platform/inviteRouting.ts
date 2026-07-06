/**
 * Route into a specific room of a game. Every game is its own SPA on its own origin: we wake the
 * game (orchestrator), mint a fresh SSO handoff token and redirect carrying the room (`?join=`), so
 * the game resolves the rest. Shared by the `?invite=` deep link, the "Join" button on a pushed
 * invite, and "Присоединиться" on a live lobby (Найти группы) — all three land in the same place.
 */
import type { GameInfo } from './games.js';
import type { Invite, InviteRole } from '@mygame/protocol';
import { GAMES } from './games.js';
import { enterGame } from '../net/orchestratorClient.js';
import { getHandoff } from '@mygame/sdk';

export const routeToRoom = async (game: GameInfo, room: string, role: InviteRole = 'player'): Promise<void> => {
  await enterGame(game.id);
  const handoff = await getHandoff();
  if (!game.externalPort) return;
  const params = new URLSearchParams();
  if (handoff) params.set('pt', handoff);
  params.set('join', room);
  if (role === 'spectator') params.set('spectate', '1');
  // Always http:, never window.location.protocol: a game's own port has no TLS of its own (the
  // hub's own domain cert doesn't cover other ports, and there's no per-port ACME setup on this
  // host) — inheriting https: from an https: hub page would break the navigation outright.
  window.location.href = `http://${window.location.hostname}:${game.externalPort}/?${params.toString()}`;
};

export const routeToInvite = async (inv: Invite): Promise<void> => {
  const game = GAMES.find((g) => g.id === inv.game);
  if (!game) return;
  await routeToRoom(game, inv.room, inv.role);
};
