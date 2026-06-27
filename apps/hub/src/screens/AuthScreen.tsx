import { useState, type CSSProperties } from 'react';
import { usePlatformStore } from '../platform/platformStore.js';

const shell: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #0b0f16 0%, #16243a 100%)',
  pointerEvents: 'auto',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '14px 18px',
  borderRadius: '4px',
  background: 'rgba(0, 0, 0, 0.4)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  fontSize: '14px',
  outline: 'none',
  transition: 'border-color 0.2s',
};

const primaryBtn: CSSProperties = {
  flex: 1,
  padding: '14px 18px',
  borderRadius: '4px',
  background: '#1a9fff',
  color: '#fff',
  fontWeight: 800,
  fontSize: '14px',
  border: 'none',
  cursor: 'pointer',
  transition: 'transform 0.1s',
};

const secondaryBtn: CSSProperties = {
  flex: 1,
  padding: '14px 18px',
  borderRadius: '4px',
  background: '#3d4450',
  color: '#fff',
  fontWeight: 800,
  fontSize: '14px',
  border: 'none',
  cursor: 'pointer',
  transition: 'transform 0.1s',
};

export const AuthScreen = (): JSX.Element => {
  const login = usePlatformStore((s) => s.login);
  const status = usePlatformStore((s) => s.status);
  const error = usePlatformStore((s) => s.error);
  
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const goLogin = () => name.trim() && password && void login(name.trim());

  return (
    <div style={shell}>
      <div 
        className="civa-panel civa-fade-in" 
        style={{ 
          width: 440, 
          padding: '40px', 
          background: '#1b2838',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
          border: '1px solid #2a3f5a',
          borderRadius: 8
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: '32px', fontWeight: 900, letterSpacing: 2, margin: 0, color: '#fff' }}>
            NEXUS
          </h1>
          <p style={{ color: '#8f98a0', marginTop: 8, fontSize: '14px' }}>
            Пожалуйста, авторизуйтесь
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input
            autoFocus
            value={name}
            placeholder="Имя аккаунта"
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            onFocus={(e) => e.target.style.borderColor = '#1a9fff'}
            onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
          />
          <input
            type="password"
            value={password}
            placeholder="Пароль"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && goLogin()}
            style={inputStyle}
            onFocus={(e) => e.target.style.borderColor = '#1a9fff'}
            onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
          />
          
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <button
              disabled={!name.trim() || !password || status === 'logging-in'}
              onClick={goLogin}
              style={{ ...primaryBtn, opacity: (!name.trim() || !password) ? 0.5 : 1 }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {status === 'logging-in' ? 'Заходим...' : 'Авторизация'}
            </button>

            <button
              disabled={!name.trim() || !password || status === 'logging-in'}
              onClick={goLogin} // Mock same behavior for registration
              style={{ ...secondaryBtn, opacity: (!name.trim() || !password) ? 0.5 : 1 }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              Регистрация
            </button>
          </div>
        </div>

        {error && (
          <div style={{ color: '#ff5c5c', fontSize: '13px', marginTop: 24, padding: '12px', background: 'rgba(255, 92, 92, 0.1)', borderRadius: '4px', textAlign: 'center' }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
};
