import { useEffect, useRef, useState } from 'react';
import { usePlatformStore } from './platform/platformStore.js';
import { useSocialStore, useChatStore, useCallStore, useToastStore } from '@mygame/sdk';
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
  const invites = useSocialStore((s) => s.invites);
  const seenInvites = useRef<Set<string>>(new Set());

  useEffect(() => {
    usePlatformStore.getState().restore();
  }, []);

  // A friend's pushed game invite → a prominent Steam-style bottom-right toast with Join/Later
  // (the 🔔 bell alone was too easy to miss). Each code toasts once.
  useEffect(() => {
    for (const inv of invites) {
      if (seenInvites.current.has(inv.code)) continue;
      seenInvites.current.add(inv.code);
      useToastStore.getState().addToast({
        type: 'invite',
        title: `${inv.inviterName} зовёт в игру`,
        content: inv.gameName,
        icon: '🎮',
        duration: 20000,
        onClick: () => void routeToInvite(inv),
        actions: [
          { label: 'Присоединиться', primary: true, onClick: () => void routeToInvite(inv) },
          { label: 'Позже', onClick: () => useSocialStore.getState().dismissInvite(inv.code) },
        ],
      });
    }
  }, [invites]);

  useEffect(() => {
    if (account) {
      void useSocialStore.getState().connect();
      void useChatStore.getState().connect();
      // Portable calls: the hub never calls mygame.init(), so trigger the post-navigation call
      // resume explicitly (game→hub direction; chatStore re-registers the signaling on connect).
      void useCallStore.getState().resume();
    } else {
      useSocialStore.getState().disconnect();
      useChatStore.getState().disconnect();
    }
  }, [account?.accountId]);

  // Revive the sockets when the tab comes back to the foreground or the network returns — a phone
  // that slept for a while kills the websockets, and socket.io's own reconnect reuses the stale
  // (15-min) access token so it can't re-auth. connect() mints a fresh token and a fresh socket, so
  // the user never has to reload. Idempotent — connect() no-ops while already connected.
  useEffect(() => {
    if (!account) return;
    const revive = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (useSocialStore.getState().status !== 'connected') void useSocialStore.getState().connect();
      if (useChatStore.getState().status !== 'connected') void useChatStore.getState().connect();
      void useCallStore.getState().resume();
    };
    document.addEventListener('visibilitychange', revive);
    window.addEventListener('online', revive);
    // pageshow fires when a page is restored from the bfcache (common on mobile tab switches).
    window.addEventListener('pageshow', revive);
    return () => {
      document.removeEventListener('visibilitychange', revive);
      window.removeEventListener('online', revive);
      window.removeEventListener('pageshow', revive);
    };
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
        useToastStore.getState().addToast({
          type: 'system',
          title: 'Приглашение',
          content: 'Приглашение не найдено или истекло.',
          icon: '✉️',
        });
        return;
      }
      await routeToInvite(invite);
    })();
  }, [account?.accountId, inviteCode]);

  return account ? <HubScreen /> : <AuthScreen />;
};
