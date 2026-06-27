import { useEffect, useState, type CSSProperties } from 'react';
import { FriendsSidebar } from '../platform/FriendsSidebar.js';

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9000,
  background: 'rgba(0, 0, 0, 0.75)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  flexDirection: 'column',
  color: '#e8eef6',
};

const headerStyle: CSSProperties = {
  padding: '24px 40px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%)',
};

export const SteamOverlay = (): JSX.Element | null => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div style={overlayStyle} className="civa-fade-in" onClick={(e) => {
      if (e.target === e.currentTarget) setIsOpen(false);
    }}>
      <div style={headerStyle}>
        <div style={{ fontSize: '24px', fontWeight: 800 }}>ОВЕРЛЕЙ STEAM</div>
        <div style={{ color: '#9aa9bd' }}>Нажмите Shift+Tab чтобы закрыть</div>
      </div>
      
      {/* Container for floating windows inside overlay */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* Friends window embedded in overlay */}
        <div style={{ position: 'absolute', right: 40, bottom: 40, width: 320, height: 600, background: '#1a1f29', borderRadius: 4, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.8)' }}>
          <FriendsSidebar inOverlay={true} />
        </div>
      </div>
    </div>
  );
};
