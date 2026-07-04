import { useEffect, useState } from 'react';
import { usePlatformStore } from './platform/platformStore.js';
import { useSocialStore, useChatStore } from '@mygame/sdk';
import { resolveInvite } from './net/inviteClient.js';
import { routeToInvite } from './platform/inviteRouting.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { HubScreen } from './screens/HubScreen.js';

/** Reads `?invite=CODE` once on load (before any navigation strips it) — null if absent. */
const readInviteCodeFromUrl = (): string | null => new URLSearchParams(window.location.search).get('invite');

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
  const [inviteCode] = useState(readInviteCodeFromUrl);

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

  // A `?invite=CODE` deep link auto-joins once we have an account (logging in first if needed —
  // AuthScreen renders below until then). Strips the param either way so a refresh doesn't retrigger.
  useEffect(() => {
    if (!account || !inviteCode) return;
    void (async () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url);

      const invite = await resolveInvite(inviteCode);
      if (!invite) {
        alert('Приглашение не найдено или истекло.');
        return;
      }
      await routeToInvite(invite);
    })();
  }, [account?.accountId, inviteCode]);

  return account ? <HubScreen /> : <AuthScreen />;
};
