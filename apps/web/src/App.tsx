import { useEffect } from 'react';
import { usePlatformStore } from './platform/platformStore.js';
import { useSocialStore } from './state/socialStore.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { HubScreen } from './screens/HubScreen.js';

/**
 * Top-level router for the mygame hub:
 *   not logged in  -> AuthScreen
 *   logged in      -> HubScreen (the launcher/library; each game opens on its own origin)
 *
 * The social connection (game-agnostic friends/presence) opens once we have an account. Overlay
 * primitives (toasts, context menu, chat) are rendered inside HubScreen for now; they move into the
 * self-mounting @mygame/sdk overlay in Phase 2.
 */
export const App = (): JSX.Element => {
  const account = usePlatformStore((s) => s.account);

  useEffect(() => {
    usePlatformStore.getState().restore();
  }, []);

  useEffect(() => {
    if (account) void useSocialStore.getState().connect();
    else useSocialStore.getState().disconnect();
  }, [account?.accountId]);

  return account ? <HubScreen /> : <AuthScreen />;
};
