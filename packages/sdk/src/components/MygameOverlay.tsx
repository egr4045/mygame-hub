import { ToastContainer } from './ToastContainer.js';
import { ContextMenu } from './ContextMenu.js';

/**
 * The mygame overlay: toast notifications + the right-click context menu, mounted once by the host.
 * Today the hub renders it directly; in Phase 2 step 2 the SDK mounts this itself into an isolated
 * Shadow-DOM root so it works on top of any game regardless of framework.
 */
export const MygameOverlay = (): JSX.Element => (
  <>
    <ToastContainer />
    <ContextMenu />
  </>
);
