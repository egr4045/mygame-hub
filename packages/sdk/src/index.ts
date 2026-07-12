/**
 * @mygame/sdk — the platform SDK every game embeds. Today it surfaces the React stores + overlay
 * components the hub uses; Phase 2 step 2 adds a framework-agnostic core (`mygame.init/auth/social/
 * ui/...`) and a self-mounting Shadow-DOM overlay, with these React hooks kept as a thin binding.
 */
export * from './state/toastStore.js';
export * from './state/notificationPrefsStore.js';
export * from './state/socialStore.js';
export * from './state/chatStore.js';
export * from './state/callStore.js';
export * from './state/menuStore.js';

export * from './components/ToastContainer.js';
export * from './components/ContextMenu.js';
export { ChatWidget } from './components/ChatWidget.js';
export { CallView } from './components/call/CallView.js';
export { FriendsWidget } from './components/FriendsWidget.js';
export { FriendsSidebar } from './components/FriendsSidebar.js';
export { MygameOverlay } from './components/MygameOverlay.js';
export { SocialDndProvider } from './components/SocialDndProvider.js';
export * from './overlay/mount.js';

export * from './config.js';
export * from './authClient.js';
export * from './statsClient.js';
export * from './communityClient.js';
export * from './emitter.js';
export * from './client.js';
