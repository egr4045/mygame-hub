import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useChatStore } from '../state/chatStore.js';
import { useSocialStore } from '../state/socialStore.js';
import { useToastStore } from '../state/toastStore.js';

export const SocialDndProvider = ({ children }: { children: React.ReactNode }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // minimum distance before drag starts to not interfere with clicks
      },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    // We encode the type in the IDs, e.g. "friend:123" dropped on "chat:456"
    const activeData = String(active.id).split(':');
    const overData = String(over.id).split(':');

    if (activeData[0] === 'friend' && overData[0] === 'chat') {
      const friendId = activeData[1]!;
      const chatId = overData[1];
      if (!chatId) return;

      const { friends } = useSocialStore.getState();
      const friend = friends.find((f) => f.accountId === friendId);
      
      if (!friend) return;

      const { addMembers, openChatWithUser } = useChatStore.getState();
      const addToast = useToastStore.getState().addToast;

      if (chatId === 'new') {
        // Dragged to a "new chat" drop zone
        openChatWithUser(friendId, friend.displayName);
      } else {
        // Dragged to an existing chat
        addMembers(chatId, [friendId]);
        addToast({
          type: 'system',
          title: 'Пользователь добавлен',
          content: `${friend.displayName} добавлен в чат`,
          icon: '👥'
        });
      }
    }
  };

  return <DndContext sensors={sensors} onDragEnd={handleDragEnd}>{children}</DndContext>;
};
