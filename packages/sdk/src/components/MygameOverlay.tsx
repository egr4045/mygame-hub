import { ToastContainer } from './ToastContainer.js';
import { ContextMenu } from './ContextMenu.js';
import { ChatWidget } from './ChatWidget.js';
import { FriendsWidget } from './FriendsWidget.js';

/**
 * The mygame overlay: toast notifications, the right-click context menu, the chat widget (DMs +
 * groups) and the friends widget, mounted once by the host into an isolated Shadow-DOM root
 * (`mountOverlay`) so any embedded game gets the platform's social UI without writing any of its own.
 * The hub renders the same components directly in its own tree instead (see `HubScreen.tsx`), not
 * through this overlay.
 */
export const MygameOverlay = (): JSX.Element => (
  <>
    <ToastContainer />
    <ContextMenu />
    <ChatWidget />
    <FriendsWidget />
  </>
);
