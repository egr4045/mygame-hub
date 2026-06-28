import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  status?: 'sent' | 'delivered' | 'read';
  reactions?: Record<string, number>;
}

export interface ChatSession {
  id: string;
  type: 'dm' | 'group';
  name: string;
  participants: string[];
  messages: ChatMessage[];
  avatar?: string;
}

interface ChatState {
  isOpen: boolean;
  activeChatId: string | null;
  sessions: ChatSession[];
  toggleChat: () => void;
  openChat: (chatId: string) => void;
  openChatWithUser: (userId: string, userName: string) => void;
  sendMessage: (chatId: string, text: string, senderId: string) => void;
}

// Initial mock data
const MOCK_SESSIONS: ChatSession[] = [
  {
    id: 'chat_dm_friend_s1mple',
    type: 'dm',
    name: 'S1mple',
    participants: ['user_me', 'friend_s1mple'],
    avatar: '🎯',
    messages: [
      { id: 'm1', senderId: 'friend_s1mple', text: 'Пойдем рейтинг катать?', timestamp: 'Вчера, 20:45' },
      { id: 'm2', senderId: 'user_me', text: 'Давай, я зайду через 5 минут', timestamp: 'Вчера, 20:46', status: 'read', reactions: { '👍': 1 } },
      { id: 'm3', senderId: 'friend_s1mple', text: 'Жду в лобби', timestamp: 'Вчера, 20:50' }
    ]
  },
  {
    id: 'chat_group_1',
    type: 'group',
    name: 'Турнир CS2 (Группа)',
    participants: ['user_me', 'friend_s1mple', 'friend_2'],
    avatar: '🏆',
    messages: [
      { id: 'gm1', senderId: 'CyberCat', text: 'Завтра играем в 20:00', timestamp: '19:30' },
      { id: 'gm2', senderId: 'user_me', text: 'Понял, буду', timestamp: '19:31', status: 'read' }
    ]
  }
];

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  activeChatId: null,
  sessions: MOCK_SESSIONS,
  toggleChat: () => set((state) => ({ isOpen: !state.isOpen })),
  openChat: (chatId) => set({ isOpen: true, activeChatId: chatId }),
  openChatWithUser: (userId, userName) => {
    const { sessions } = get();
    // Try to find existing DM
    const existing = sessions.find(s => s.type === 'dm' && s.participants.includes(userId));
    if (existing) {
      set({ isOpen: true, activeChatId: existing.id });
    } else {
      // Create new DM session
      const newSession: ChatSession = {
        id: `chat_dm_${userId}`,
        type: 'dm',
        name: userName,
        participants: ['user_me', userId],
        avatar: '👤',
        messages: [
          { id: 'sys1', senderId: 'system', text: 'История сообщений пуста', timestamp: '' }
        ]
      };
      set({ sessions: [...sessions, newSession], isOpen: true, activeChatId: newSession.id });
    }
  },
  sendMessage: (chatId, text, senderId) => {
    set((state) => ({
      sessions: state.sessions.map(s => {
        if (s.id === chatId) {
          return {
            ...s,
            messages: [...s.messages, { id: Math.random().toString(), senderId, text, timestamp: 'Только что', status: 'sent' }]
          };
        }
        return s;
      })
    }));
  }
}));
