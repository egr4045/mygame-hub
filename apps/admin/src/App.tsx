import { useEffect, useState } from 'react';
import { loadSession, login, clearSession, freshAccessToken, config } from '@mygame/sdk';
import { GamesScreen } from './screens/GamesScreen.js';
import { UsersScreen } from './screens/UsersScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';

type Tab = 'games' | 'users' | 'settings';
/** Distinct from "logged out" — a logged-in non-admin sees a clear "not authorized" state rather
 *  than silently empty screens (the one place this app deviates from the hub's usual "silent
 *  fallback to defaults" convention: 403 and "no data" mean different things here). */
type AccessStatus = 'checking' | 'forbidden' | 'ok';

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid #2a3f5a',
  borderRadius: 8,
  padding: 24,
};

const button: React.CSSProperties = {
  background: '#1a9fff',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  padding: '10px 20px',
  fontWeight: 600,
  cursor: 'pointer',
};

export const App = (): JSX.Element => {
  const [account, setAccount] = useState<{ accountId: string; displayName: string } | null>(() => {
    const s = loadSession();
    return s ? { accountId: s.accountId, displayName: s.displayName } : null;
  });
  const [nameInput, setNameInput] = useState('');
  const [access, setAccess] = useState<AccessStatus>('checking');
  const [tab, setTab] = useState<Tab>('games');

  // Every screen's own data calls also re-check admin access via their own 403s, but this one
  // upfront check is what decides whether to show the app shell at all.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setAccess('checking');
    void (async () => {
      const token = await freshAccessToken();
      if (!token) {
        if (!cancelled) setAccess('forbidden');
        return;
      }
      const res = await fetch(`${config.authUrl}/auth/admin/admins`, { headers: { authorization: `Bearer ${token}` } });
      if (!cancelled) setAccess(res.ok ? 'ok' : 'forbidden');
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  const handleLogin = async (): Promise<void> => {
    if (!nameInput.trim()) return;
    const session = await login(nameInput.trim());
    setAccount({ accountId: session.accountId, displayName: session.displayName });
  };

  const handleLogout = (): void => {
    clearSession();
    setAccount(null);
    setAccess('checking');
  };

  if (!account) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#12161d', color: '#dcdedf', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ ...card, width: 360, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>GAMEHUB — Admin</h1>
          <p style={{ color: '#8f98a0', fontSize: 13, marginBottom: 24 }}>
            Тот же логин, что и в хабе — доступ проверяется по роли на сервере.
          </p>
          <input
            placeholder="Ваше имя"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
            style={{ width: '100%', boxSizing: 'border-box', background: '#171a21', border: '1px solid #2a3f5a', borderRadius: 4, padding: '10px 12px', color: '#fff', marginBottom: 12 }}
          />
          <button onClick={() => void handleLogin()} style={{ ...button, width: '100%' }}>Войти</button>
        </div>
      </div>
    );
  }

  if (access !== 'ok') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#12161d', color: '#dcdedf', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ ...card, width: 360, textAlign: 'center' }}>
          {access === 'checking' ? (
            <p style={{ color: '#8f98a0', fontSize: 13 }}>Проверка доступа…</p>
          ) : (
            <>
              <p style={{ fontSize: 14, marginBottom: 16 }}>
                У аккаунта «{account.displayName}» нет прав администратора.
              </p>
              <button onClick={handleLogout} style={button}>Выйти</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#12161d', color: '#dcdedf', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 5%', borderBottom: '1px solid #2a3f5a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>GAMEHUB ADMIN</div>
          {(['games', 'users', 'settings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none',
                border: 'none',
                color: tab === t ? '#fff' : '#8f98a0',
                fontWeight: tab === t ? 700 : 400,
                fontSize: 14,
                cursor: 'pointer',
                borderBottom: tab === t ? '2px solid #1a9fff' : '2px solid transparent',
                padding: '4px 0',
              }}
            >
              {t === 'games' ? 'ИГРЫ' : t === 'users' ? 'ПОЛЬЗОВАТЕЛИ' : 'НАСТРОЙКИ'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: '#8f98a0' }}>{account.displayName}</span>
          <button onClick={handleLogout} style={{ ...button, padding: '6px 14px', fontSize: 13 }}>Выйти</button>
        </div>
      </div>

      <div style={{ padding: '32px 5%' }}>
        {tab === 'games' && <GamesScreen />}
        {tab === 'users' && <UsersScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </div>
    </div>
  );
};
