/**
 * Route into a specific room of a game. Every game is its own SPA on its own origin: we wake the
 * game (orchestrator), mint a fresh SSO handoff token and redirect carrying the room (`?join=`), so
 * the game resolves the rest. Shared by the `?invite=` deep link, the "Join" button on a pushed
 * invite, and "Присоединиться" on a live lobby (Найти группы) — all three land in the same place.
 */
import type { GameInfo } from './games.js';
import type { Invite, InviteRole } from '@mygame/protocol';
import { GAMES, getGameOrigin } from './games.js';
import { enterGame } from '../net/orchestratorClient.js';
import { showLaunchOverlay } from './launchOverlay.js';
import { getHandoff, useCallStore, waitGameReady } from '@mygame/sdk';

export const routeToRoom = async (game: GameInfo, room: string, role: InviteRole = 'player'): Promise<void> => {
  const base = getGameOrigin(game);
  if (!base) return;
  // Тот же холодный старт, что и у кнопки «Играть»: без заставки игрок видел 502,
  // а без проверки готовности — уходил в игру раньше, чем та начинала слушать порт.
  const overlay = showLaunchOverlay(game.name);
  await enterGame(game.id);
  if (!(await waitGameReady(`${base}/`))) {
    overlay.fail('Игра не отвечает. Попробуйте ещё раз через минуту.');
    return;
  }
  const handoff = await getHandoff();
  const params = new URLSearchParams();
  if (handoff) params.set('pt', handoff);
  params.set('join', room);
  if (role === 'spectator') params.set('spectate', '1');
  // Звонок должен пережить переход: без ключа игра стартует «в тишине» и участник
  // выпадает из разговора (localStorage спасает только при совпадении origin).
  const { callKey, status } = useCallStore.getState();
  if (callKey && status !== 'idle') params.set('call', callKey);
  overlay.finish();
  window.location.href = `${base}/?${params.toString()}`;
};

export const routeToInvite = async (inv: Invite): Promise<void> => {
  const game = GAMES.find((g) => g.id === inv.game);
  if (!game) return;
  await routeToRoom(game, inv.room, inv.role);
};
