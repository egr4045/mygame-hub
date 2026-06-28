import { useEffect, useRef } from 'react';
import { useMenuStore } from '../state/menuStore.js';

export const ContextMenu = (): JSX.Element | null => {
  const { menu, closeMenu } = useMenuStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    
    // Close on any click outside or inside if we don't prevent it
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeMenu]);

  if (!menu) return null;

  // Simple bounds checking so menu doesn't go off screen
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - (menu.items.length * 36));

  return (
    <div 
      ref={menuRef}
      className="civa-fade-in"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width: 220,
        background: '#1b2838',
        border: '1px solid #3d4450',
        borderRadius: 4,
        boxShadow: '0 8px 16px rgba(0,0,0,0.8)',
        zIndex: 9999,
        padding: '4px 0',
        display: 'flex',
        flexDirection: 'column'
      }}
      onContextMenu={(e) => e.preventDefault()} // prevent default inside our own menu
    >
      {menu.items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ height: 1, background: '#3d4450', margin: '4px 0' }} />;
        }
        
        return (
          <div
            key={i}
            onClick={() => {
              if (item.disabled) return;
              item.action();
              closeMenu();
            }}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              color: item.disabled ? '#6c7784' : (item.danger ? '#ff5c5c' : '#dcdedf'),
              cursor: item.disabled ? 'default' : 'pointer',
              background: 'transparent',
              transition: 'background 0.1s, color 0.1s'
            }}
            onMouseOver={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.background = item.danger ? 'rgba(255, 92, 92, 0.2)' : '#2a475e';
                e.currentTarget.style.color = '#fff';
              }
            }}
            onMouseOut={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = item.danger ? '#ff5c5c' : '#dcdedf';
              }
            }}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
};
