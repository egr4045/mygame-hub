/**
 * Asks the platform orchestrator to wake a game before we connect (it starts the game's services
 * on demand and stops them when idle). Same-origin via the gateway (`/orchestrator/*`).
 *
 * Best-effort: in dev there's no orchestrator (the lobby runs always-on), so a failure is ignored
 * and we proceed straight to connecting. In prod the request resolves once the game is up.
 */
export const enterGame = async (id: string): Promise<void> => {
  try {
    await fetch(`/orchestrator/games/${id}/enter`, {
      method: 'POST',
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    // no orchestrator (dev) or a transient error — the lobby connect will surface real problems.
  }
};
