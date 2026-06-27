import { type CSSProperties } from 'react';
import { usePlatformStore } from '../platform/platformStore.js';

const panelStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.03)',
  borderRadius: 'var(--r-lg)',
  padding: '24px',
  border: '1px solid var(--c-panel-border)',
  display: 'flex',
  alignItems: 'center',
  gap: '24px',
  marginBottom: '32px'
};

const avatarStyle: CSSProperties = {
  width: '80px',
  height: '80px',
  borderRadius: '16px',
  background: 'linear-gradient(135deg, var(--c-accent), #7c6cf0)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '32px',
  boxShadow: '0 8px 24px rgba(61, 169, 252, 0.3)'
};

const achievementStyle: CSSProperties = {
  width: '40px',
  height: '40px',
  borderRadius: '50%',
  background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '20px',
  cursor: 'pointer'
};

export const ProfileWidget = (): JSX.Element => {
  const account = usePlatformStore((s) => s.account);

  if (!account) return <></>;

  // Stub data until backend supports it
  const achievements = ['🏆', '⚔️', '🌍'];
  const avatar = '👤';

  return (
    <div style={panelStyle} className="civa-fade-in">
      <div style={avatarStyle}>
        {avatar}
      </div>
      <div style={{ flex: 1 }}>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, margin: '0 0 4px 0' }}>{account.displayName}</h2>
        <div style={{ color: 'var(--c-text-muted)', fontSize: 'var(--fs-sm)', marginBottom: '16px' }}>
          Status: <span style={{ color: 'var(--c-positive)' }}>Online</span>
        </div>
        
        <div>
          <div style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', color: 'var(--c-text-muted)', letterSpacing: 1, marginBottom: 8 }}>
            Latest Achievements
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {achievements.map((ach, i) => (
              <div key={i} style={achievementStyle} title="Achievement (mock)">
                {ach}
              </div>
            ))}
            <div style={{ ...achievementStyle, borderStyle: 'dashed', opacity: 0.5 }} title="Locked">
              🔒
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
