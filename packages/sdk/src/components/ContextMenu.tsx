import { useEffect, useRef } from 'react';
import { useMenuStore } from '../state/menuStore.js';
import { mg, mgZ } from '../theme/tokens.js';
import { surfaceWindow } from '../theme/primitives.js';
import { getViewport } from '../hooks/useViewport.js';

export const ContextMenu = (): JSX.Element | null => {
  const { menu, closeMenu } = useMenuStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // composedPath so this also works inside the SDK's Shadow-DOM overlay — events retarget at the
      // shadow boundary, so `contains(e.target)` would wrongly report "outside" for our own menu.
      if (menuRef.current && !e.composedPath().includes(menuRef.current)) {
        closeMenu();
      }
    };
    
    // Close on any click outside or inside if we don't prevent it
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeMenu]);

  if (!menu) return null;

  // Simple bounds checking so menu doesn't go off screen (visualViewport-aware).
  const vp = getViewport();
  const x = Math.max(4, Math.min(menu.x, vp.w - 220));
  const y = Math.max(4, Math.min(menu.y, vp.h - menu.items.length * 36));

  return (
    <div 
      ref={menuRef}
      className="mygame-fade-in"
      style={{
        ...surfaceWindow,
        position: 'fixed',
        left: x,
        top: y,
        width: 220,
        borderRadius: mg.rMd,
        boxShadow: mg.shadowPopover,
        zIndex: mgZ.menu,
        pointerEvents: 'auto',
        padding: '4px 0',
        display: 'flex',
        flexDirection: 'column'
      }}
      onContextMenu={(e) => e.preventDefault()} // prevent default inside our own menu
    >
      {menu.items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ height: 1, background: mg.border, margin: '4px 0' }} />;
        }

        return (
          <div
            key={i}
            className={item.disabled ? undefined : 'cw-menu-item'}
            data-danger={item.danger ? 'true' : undefined}
            onClick={() => {
              if (item.disabled) return;
              item.action();
              closeMenu();
            }}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              color: item.disabled ? mg.textMuted : (item.danger ? mg.danger : mg.text),
              cursor: item.disabled ? 'default' : 'pointer',
              background: 'transparent'
            }}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
};
