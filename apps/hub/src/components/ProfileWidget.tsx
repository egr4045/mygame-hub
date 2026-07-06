import { type CSSProperties, useEffect, useState } from 'react';
import { usePlatformStore } from '../platform/platformStore.js';
import { useSocialStore, getAchievements } from '@mygame/sdk';
import { ACHIEVEMENTS, CIVA_GAME_ID, type AchievementDef } from '../platform/achievementsCatalog.js';

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
  fontWeight: 800,
  color: '#fff',
  overflow: 'hidden',
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
  cursor: 'default'
};

export const ProfileWidget = (): JSX.Element => {
  const account = usePlatformStore((s) => s.account);
  const me = useSocialStore((s) => s.me);
  const online = useSocialStore((s) => s.status) === 'connected';

  // Real unlocked CIVA achievements, resolved against the shared display catalog.
  const [unlocked, setUnlocked] = useState<AchievementDef[]>([]);
  useEffect(() => {
    void getAchievements().then((res) => {
      const ids = new Set(
        (res?.achievements ?? [])
          .filter((a) => a.gameId === CIVA_GAME_ID)
          .map((a) => a.achievementId),
      );
      setUnlocked(ACHIEVEMENTS.filter((a) => ids.has(a.id)));
    });
  }, []);

  if (!account) return <></>;

  const avatarUrl = me?.avatarIcon ?? null;
  const showcase = unlocked.slice(0, 4);

  return (
    <div style={panelStyle} className="civa-fade-in">
      <div style={avatarStyle}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          account.displayName[0]?.toUpperCase() ?? '👤'
        )}
      </div>
      <div style={{ flex: 1 }}>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, margin: '0 0 4px 0' }}>{account.displayName}</h2>
        <div style={{ color: 'var(--c-text-muted)', fontSize: 'var(--fs-sm)', marginBottom: '16px' }}>
          Статус: <span style={{ color: online ? 'var(--c-positive)' : 'var(--c-text-muted)' }}>{online ? 'В сети' : 'Не в сети'}</span>
        </div>

        <div>
          <div style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', color: 'var(--c-text-muted)', letterSpacing: 1, marginBottom: 8 }}>
            Достижения
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {showcase.map((ach) => (
              <div key={ach.id} style={{ ...achievementStyle, borderColor: `${ach.color}66` }} title={`${ach.name} — ${ach.desc}`}>
                {ach.icon}
              </div>
            ))}
            {showcase.length === 0 && (
              <div style={{ color: 'var(--c-text-muted)', fontSize: 'var(--fs-sm)' }}>Пока нет достижений</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
