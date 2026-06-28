import { useState } from 'react';
import { FriendsSidebar } from '../platform/FriendsSidebar.js';
import { useSocialStore } from '@mygame/sdk';
import { useMenuStore } from '@mygame/sdk';
import { usePlatformStore } from '../platform/platformStore.js';

export const FriendsWidget = (): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const openMenu = useMenuStore((s) => s.openMenu);
  const activeGameId = usePlatformStore((s) => s.selectedGame);
  const friends = useSocialStore((s) => s.friends);
  const onlineCount = friends.filter(f => f.status === 'accepted' && f.presence === 'online').length;

  return (
    <div style={{ position: 'fixed', bottom: 0, right: 24, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      
      {/* Expanded window */}
      <div style={{ 
        width: 320, 
        height: 500, 
        background: '#1b2838', 
        borderRadius: '8px 8px 0 0', 
        overflow: 'hidden',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.5)',
        display: isOpen ? 'flex' : 'none',
        flexDirection: 'column',
        marginBottom: 1
      }}>
        <div style={{ background: '#171a21', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setIsOpen(false)}>
          <div style={{ fontWeight: 700, fontSize: '13px', color: '#dcdedf' }}>Список друзей и чат</div>
          <button style={{ background: 'transparent', border: 'none', color: '#8f98a0', cursor: 'pointer' }}>_</button>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <FriendsSidebar inOverlay={true} />
        </div>
      </div>

      {/* Minimized button */}
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)}
          style={{ 
            background: '#171a21', 
            color: '#dcdedf',
            border: 'none',
            borderRadius: '8px 8px 0 0',
            padding: '16px 24px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 -4px 12px rgba(0,0,0,0.7)',
            width: '100%',
            justifyContent: 'center'
          }}
        >
          <span style={{ fontSize: '18px', fontWeight: 700 }}>Друзья и чат</span>
          <span style={{ fontSize: '16px', background: '#3d4450', padding: '4px 12px', borderRadius: 6 }}>В сети: {onlineCount}</span>
        </button>
      )}
    </div>
  );
};
