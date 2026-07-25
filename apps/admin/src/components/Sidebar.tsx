import { type ReactNode } from 'react';

type Tab = 'dashboard' | 'games' | 'users' | 'suggestions' | 'settings';

interface SidebarProps {
  currentTab: Tab;
  onChangeTab: (tab: Tab) => void;
  onLogout: () => void;
  adminName: string;
}

export const Sidebar = ({ currentTab, onChangeTab, onLogout, adminName }: SidebarProps): JSX.Element => {
  const navItem = (tab: Tab, label: string, icon: string) => {
    const isActive = currentTab === tab;
    return (
      <button
        onClick={() => onChangeTab(tab)}
        style={{
          background: isActive ? 'rgba(76, 154, 255, 0.1)' : 'transparent',
          color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
          border: 'none',
          borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
          borderRadius: '0 8px 8px 0',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 15,
          fontWeight: isActive ? 600 : 500,
          cursor: 'pointer',
          transition: 'all 0.2s',
          width: 'calc(100% - 16px)',
          textAlign: 'left',
          marginBottom: 4,
        }}
        onMouseOver={(e) => {
          if (!isActive) e.currentTarget.style.color = 'var(--text-main)';
        }}
        onMouseOut={(e) => {
          if (!isActive) e.currentTarget.style.color = 'var(--text-muted)';
        }}
      >
        <span>{icon}</span>
        {label}
      </button>
    );
  };

  return (
    <div style={{
      width: 260,
      background: 'rgba(10, 13, 20, 0.8)',
      backdropFilter: 'var(--glass-blur)',
      borderRight: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0,
    }}>
      <div style={{ padding: '24px 24px 32px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>G</div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>HUB ADMIN</div>
      </div>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {navItem('dashboard', 'Дашборд', '📊')}
        {navItem('games', 'Игры и Лобби', '🎮')}
        {navItem('users', 'Пользователи', '👥')}
        {navItem('suggestions', 'Предложения', '💡')}
        {navItem('settings', 'Настройки', '⚙️')}
      </nav>

      <div style={{ padding: '24px', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--border-color)' }} />
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{adminName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Admin</div>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onLogout} style={{ width: '100%', justifyContent: 'center' }}>
          Выйти
        </button>
      </div>
    </div>
  );
};
