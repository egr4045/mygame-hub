import { useState, type CSSProperties } from 'react';
import { usePlatformStore } from '../platform/platformStore.js';

const shell: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, var(--c-panel-deep) 0%, var(--c-panel-solid) 100%)',
  pointerEvents: 'auto',
};

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px 18px',
  fontSize: '14px',
};

const primaryBtn: CSSProperties = {
  width: '100%',
  padding: '14px 18px',
  borderRadius: '4px',
  background: 'var(--c-accent)',
  color: '#fff',
  fontWeight: 800,
  fontSize: '14px',
  border: 'none',
  cursor: 'pointer',
  transition: 'transform 0.1s',
};

const modeTab = (active: boolean): CSSProperties => ({
  flex: 1,
  padding: '10px 0',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: '14px',
  cursor: 'pointer',
  color: active ? 'var(--c-text-primary)' : 'var(--c-text-muted)',
  borderBottom: active ? '2px solid var(--c-accent)' : '2px solid transparent',
  userSelect: 'none',
});

const inlineError: CSSProperties = {
  color: 'var(--c-negative)',
  fontSize: '13px',
  marginTop: 24,
  padding: '12px',
  background: 'rgba(224, 82, 74, 0.12)',
  borderRadius: '4px',
  textAlign: 'center',
};

type AuthMode = 'login' | 'register';

export const AuthScreen = (): JSX.Element => {
  const login = usePlatformStore((s) => s.login);
  const register = usePlatformStore((s) => s.register);
  const loginWithTelegramCode = usePlatformStore((s) => s.loginWithTelegramCode);
  const status = usePlatformStore((s) => s.status);
  const error = usePlatformStore((s) => s.error);

  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showTg, setShowTg] = useState(false);
  const [tgCode, setTgCode] = useState('');

  const busy = status === 'logging-in';
  const canSubmit = !busy && Boolean(name.trim()) && Boolean(password);

  const switchMode = (next: AuthMode): void => {
    setMode(next);
    setValidationError(null);
  };

  const submit = (): void => {
    if (!canSubmit) return;
    const trimmed = name.trim();
    if (mode === 'register') {
      if (trimmed.length < 3) {
        setValidationError('Имя должно быть не короче 3 символов');
        return;
      }
      if (password.length < 6) {
        setValidationError('Пароль должен быть не короче 6 символов');
        return;
      }
      setValidationError(null);
      void register(trimmed, password);
    } else {
      setValidationError(null);
      void login(trimmed, password);
    }
  };

  const goTgLogin = (): void => {
    if (busy || !tgCode.trim()) return;
    void loginWithTelegramCode(tgCode.trim());
  };

  return (
    <div style={shell}>
      <div
        className="civa-panel civa-fade-in"
        style={{
          width: 440,
          padding: '40px',
          background: 'var(--c-panel-solid)',
          boxShadow: '0 24px 48px var(--c-overlay)',
          border: '1px solid var(--c-panel-border)',
          borderRadius: 8
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: '32px', fontWeight: 900, letterSpacing: 2, margin: 0, color: 'var(--c-text-primary)' }}>
            GAMEHUB
          </h1>
          <p style={{ color: 'var(--c-text-muted)', marginTop: 8, fontSize: '14px' }}>
            {mode === 'login' ? 'Войдите в свой аккаунт' : 'Создайте новый аккаунт'}
          </p>
        </div>

        <div style={{ display: 'flex', marginBottom: 24, borderBottom: '1px solid var(--c-panel-border)' }}>
          <div style={modeTab(mode === 'login')} onClick={() => switchMode('login')}>Вход</div>
          <div style={modeTab(mode === 'register')} onClick={() => switchMode('register')}>Регистрация</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input
            autoFocus
            value={name}
            placeholder="Имя аккаунта"
            onChange={(e) => setName(e.target.value)}
            className="hub-input"
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            placeholder="Пароль"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="hub-input"
            style={inputStyle}
          />

          <button
            disabled={!canSubmit}
            onClick={submit}
            style={{ ...primaryBtn, marginTop: 8, opacity: canSubmit || busy ? 1 : 0.5 }}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            {busy ? (mode === 'login' ? 'Заходим...' : 'Создаём аккаунт...') : (mode === 'login' ? 'Войти' : 'Зарегистрироваться')}
          </button>
        </div>

        {(validationError ?? error) && (
          <div style={inlineError}>
            ⚠ {validationError ?? error}
          </div>
        )}

        {/* Login via a one-time code from the Telegram bot (/login) */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          {!showTg ? (
            <button
              onClick={() => setShowTg(true)}
              style={{ background: 'transparent', border: 'none', color: 'var(--c-accent)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
            >
              ✈ Войти через Telegram
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ color: 'var(--c-text-muted)', fontSize: '12px', margin: 0 }}>
                Отправь боту команду <b>/login</b> и введи полученный код:
              </p>
              <input
                value={tgCode}
                placeholder="Код из Telegram"
                onChange={(e) => setTgCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && goTgLogin()}
                className="hub-input"
                style={{ ...inputStyle, textAlign: 'center', letterSpacing: 2, textTransform: 'uppercase' }}
              />
              <button
                disabled={!tgCode.trim() || busy}
                onClick={goTgLogin}
                style={{ ...primaryBtn, opacity: tgCode.trim() && !busy ? 1 : 0.5 }}
              >
                {busy ? 'Входим...' : 'Войти по коду'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
