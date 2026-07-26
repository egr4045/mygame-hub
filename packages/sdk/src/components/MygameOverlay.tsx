import { ToastContainer } from './ToastContainer.js';
import { ContextMenu } from './ContextMenu.js';
import { ChatWidget } from './ChatWidget.js';
import { CallView } from './call/CallView.js';
import { GameInviteModal } from './call/GameInviteModal.js';
import { FriendsWidget } from './FriendsWidget.js';
import { SocialDndProvider } from './SocialDndProvider.js';

/**
 * The mygame overlay: toast notifications, the right-click context menu, the chat widget (DMs +
 * groups) and the friends widget, mounted once by the host into an isolated Shadow-DOM root
 * (`mountOverlay`) so any embedded game gets the platform's social UI without writing any of its own.
 * The hub renders the same components directly in its own tree instead (see `HubScreen.tsx`), not
 * through this overlay.
 */
export const MygameOverlay = (): JSX.Element => (
  <SocialDndProvider>
    <ToastContainer />
    <ContextMenu />
    {/* FriendsWidget is the single launcher; ChatWidget opens from it (its own launcher is hidden). */}
    <ChatWidget hideLauncher />
    <CallView />
    {/* Сиблинг CallView, а не его потомок: приглашение должно быть видно и когда окно
        звонка свёрнуто, и во встроенной игре, где CallView рисует только аудио. */}
    <GameInviteModal />
    <FriendsWidget />
  </SocialDndProvider>
);
