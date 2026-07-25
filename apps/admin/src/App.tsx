import { useEffect, useState } from 'react';
import { loadSession, login, register, clearSession, freshAccessToken, config } from '@mygame/sdk';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { GamesScreen } from './screens/GamesScreen.js';
import { UsersScreen } from './screens/UsersScreen.js';
import { SuggestionsScreen } from './screens/SuggestionsScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { Sidebar } from './components/Sidebar.js';
import { ToastProvider } from './components/ToastProvider.js';

type Tab = 'dashboard' | 'games' | 'users' | 'suggestions' | 'settings';
const TABS: Tab[] = ['dashboard', 'games', 'users', 'suggestions', 'settings'];
type AccessStatus = 'checking' | 'forbidden' | 'ok' | 'error';

/** Initial tab from the URL hash (the suggestion Telegram alert links to `/admin/#suggestions`). */
const tabFromHash = (): Tab => {
  const h = window.location.hash.replace(/^#/, '') as Tab;
  return TABS.includes(h) ? h : 'dashboard';
};

const AppContent = (): JSX.Element => {
  const [account, setAccount] = useState<{ accountId: string; displayName: string } | null>(() => {
    const s = loadSession();
    return s ? { accountId: s.accountId, displayName: s.displayName } : null;
  });
  const [nameInput, setNameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessStatus>('checking');
  const [tab, setTab] = useState<Tab>(tabFromHash);

  const [accessAttempt, setAccessAttempt] = useState(0);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setAccess('checking');
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token) {
          if (!cancelled) setAccess('forbidden');
          return;
        }
        const res = await fetch(`${config.authUrl}/auth/admin/admins`, { headers: { authorization: `Bearer ${token}` } });
        if (!cancelled) setAccess(res.ok ? 'ok' : 'forbidden');
      } catch {
        // Network/CORS failure (auth service down) is not «нет прав» — show a retryable error
        // instead of hanging on «Проверка доступа…» forever.
        if (!cancelled) setAccess('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, accessAttempt]);

  const handleLogin = async (): Promise<void> => {
    if (!nameInput.trim() || !passwordInput) return;
    setAuthError(null);
    try {
      const session = await login(nameInput.trim(), passwordInput);
      setAccount({ accountId: session.accountId, displayName: session.displayName });
    } catch {
      setAuthError('Неверный логин или пароль');
    }
  };

  const handleRegister = async (): Promise<void> => {
    if (!nameInput.trim() || !passwordInput) return;
    setAuthError(null);
    try {
      const session = await register(nameInput.trim(), passwordInput);
      setAccount({ accountId: session.accountId, displayName: session.displayName });
    } catch {
      setAuthError('Имя уже занято или ошибка регистрации');
    }
  };

  const handleLogout = (): void => {
    clearSession();
    setAccount(null);
    setAccess('checking');
  };

  if (!account) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="glass-card" style={{ width: 360, textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontWeight: 800, fontSize: 24 }}>G</div>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>GAMEHUB</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 24 }}>Admin Panel</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
            Тот же логин, что и в хабе — доступ проверяется по роли на сервере.
          </p>
          <input
            className="input-field"
            placeholder="Ваше имя"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <input
            className="input-field"
            type="password"
            placeholder="Пароль"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
            style={{ width: '100%', marginBottom: 12 }}
          />
          {authError && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{authError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => void handleLogin()} style={{ flex: 1 }}>Войти</button>
            <button className="btn btn-ghost" onClick={() => void handleRegister()} style={{ flex: 1 }}>Регистрация</button>
          </div>
        </div>
      </div>
    );
  }

  if (access !== 'ok') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="glass-card" style={{ width: 360, textAlign: 'center' }}>
          {access === 'checking' ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Проверка доступа…</p>
          ) : access === 'error' ? (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
              <p style={{ fontSize: 16, marginBottom: 8 }}>Не удалось проверить доступ</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
                Сервис авторизации недоступен. Проверьте соединение и попробуйте ещё раз.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setAccessAttempt((n) => n + 1)} style={{ flex: 1, justifyContent: 'center' }}>
                  Повторить
                </button>
                <button className="btn btn-ghost" onClick={handleLogout} style={{ flex: 1, justifyContent: 'center' }}>Выйти</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
              <p style={{ fontSize: 16, marginBottom: 24 }}>
                У аккаунта <strong style={{ color: 'var(--text-main)' }}>{account.displayName}</strong> нет прав администратора.
              </p>
              <button className="btn btn-ghost" onClick={handleLogout} style={{ width: '100%', justifyContent: 'center' }}>Выйти</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        currentTab={tab}
        onChangeTab={(t) => {
          setTab(t);
          // Reflect the tab in the URL hash so a refresh (and the suggestion deep link) lands here.
          window.location.hash = t;
        }}
        onLogout={handleLogout}
        adminName={account.displayName}
      />
      <div style={{ flex: 1, padding: '32px 40px', overflowY: 'auto' }}>
        <div className="animate-fade-in" key={tab}>
          {tab === 'dashboard' && <DashboardScreen />}
          {tab === 'games' && <GamesScreen />}
          {tab === 'users' && <UsersScreen />}
          {tab === 'suggestions' && <SuggestionsScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </div>
      </div>
    </div>
  );
};

export const App = (): JSX.Element => {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};
