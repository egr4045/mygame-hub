import { useEffect } from 'react';
import { usePlatformStore } from './platform/platformStore.js';
import { useSocialStore, useChatStore } from '@mygame/sdk';
import { AuthScreen } from './screens/AuthScreen.js';
import { HubScreen } from './screens/HubScreen.js';

/**
 * Top-level router for the mygame hub:
 *   not logged in  -> AuthScreen
 *   logged in      -> HubScreen (the launcher/library; each game opens on its own origin)
 *
 * The social and chat connections (game-agnostic friends/presence/DMs) open once we have an account.
 * Overlay primitives (toasts, context menu, chat) are rendered inside HubScreen for now; they move
 * into the self-mounting @mygame/sdk overlay in Phase 2.
 */
export const App = (): JSX.Element => {
  const account = usePlatformStore((s) => s.account);

  useEffect(() => {
    usePlatformStore.getState().restore();
  }, []);

  useEffect(() => {
    if (account) {
      void useSocialStore.getState().connect();
      void useChatStore.getState().connect();
    } else {
      useSocialStore.getState().disconnect();
      useChatStore.getState().disconnect();
    }
  }, [account?.accountId]);

  return account ? <HubScreen /> : <AuthScreen />;
};
