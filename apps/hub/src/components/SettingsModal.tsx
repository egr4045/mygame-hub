import { useState, type CSSProperties } from 'react';
import { changeDisplayName, changePassword, useNotificationPrefsStore, useSocialStore, useChatStore } from '@mygame/sdk';
import { usePlatformStore } from '../platform/platformStore.js';

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.8)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const card: CSSProperties = {
  width: 460,
  background: '#1b2838',
  border: '1px solid #3d4450',
  borderRadius: 8,
  padding: 32,
};

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 14px',
  borderRadius: 4,
  background: 'rgba(0,0,0,0.4)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
  fontSize: 13,
  outline: 'none',
};

const errorBox: CSSProperties = {
  color: '#ff5c5c',
  fontSize: 13,
  marginTop: 12,
  padding: '10px 12px',
  background: 'rgba(255,92,92,0.1)',
  borderRadius: 4,
  textAlign: 'center',
};

const okBox: CSSProperties = { ...errorBox, color: '#5c9e5c', background: 'rgba(92,158,92,0.1)' };

const btn: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 4,
  background: '#1a9fff',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  border: 'none',
  cursor: 'pointer',
};

const ghostBtn: CSSProperties = { ...btn, background: '#3d4450' };

const tabBtn = (active: boolean): CSSProperties => ({
  flex: 1,
  padding: '10px 0',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  color: active ? '#fff' : '#8f98a0',
  borderBottom: active ? '2px solid #1a9fff' : '2px solid transparent',
});

const label: CSSProperties = { color: '#8f98a0', fontSize: 12, marginBottom: 6, display: 'block' };
const toggleRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #2a3f5a' };

interface Props {
  initialTab: 'notifications' | 'account';
  onClose: () => void;
  onGoToProfile: () => void;
}

export const SettingsModal = ({ initialTab, onClose, onGoToProfile }: Props): JSX.Element => {
  const [tab, setTab] = useState<'notifications' | 'account'>(initialTab);

  return (
    <div style={overlay} onClick={onClose}>
      <div className="civa-fade-in" style={card} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ color: '#fff', margin: '0 0 16px', fontSize: 20 }}>Настройки</h2>

        <div style={{ display: 'flex', marginBottom: 20, borderBottom: '1px solid #2a3f5a' }}>
          <div style={tabBtn(tab === 'notifications')} onClick={() => setTab('notifications')}>Уведомления</div>
          <div style={tabBtn(tab === 'account')} onClick={() => setTab('account')}>Аккаунт</div>
        </div>

        {tab === 'notifications' ? <NotificationsTab /> : <AccountTab onGoToProfile={() => { onGoToProfile(); onClose(); }} />}

        <button onClick={onClose} style={{ ...ghostBtn, width: '100%', marginTop: 20 }}>Закрыть</button>
      </div>
    </div>
  );
};

const NotificationsTab = (): JSX.Element => {
  const achievementToasts = useNotificationPrefsStore((s) => s.achievementToasts);
  const callToasts = useNotificationPrefsStore((s) => s.callToasts);
  const setAchievementToasts = useNotificationPrefsStore((s) => s.setAchievementToasts);
  const setCallToasts = useNotificationPrefsStore((s) => s.setCallToasts);

  return (
    <div>
      <div style={toggleRow}>
        <span style={{ color: '#dcdedf', fontSize: 14 }}>🏆 Тосты о новых достижениях</span>
        <input type="checkbox" checked={achievementToasts} onChange={(e) => setAchievementToasts(e.target.checked)} />
      </div>
      <div style={{ ...toggleRow, borderBottom: 'none' }}>
        <span style={{ color: '#dcdedf', fontSize: 14 }}>📞 Тосты о входящих звонках</span>
        <input type="checkbox" checked={callToasts} onChange={(e) => setCallToasts(e.target.checked)} />
      </div>
      <p style={{ color: '#6c7784', fontSize: 12, marginTop: 16 }}>
        Хранится только в этом браузере. Заявки в друзья и приглашения в игру по-прежнему видны в 🔔 —
        это переключает только всплывающие тосты.
      </p>
    </div>
  );
};

const AccountTab = ({ onGoToProfile }: { onGoToProfile: () => void }): JSX.Element => {
  const renameAccount = usePlatformStore((s) => s.renameAccount);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [newName, setNewName] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submitPassword = async (): Promise<void> => {
    if (!currentPassword || !newPassword) return;
    setPasswordBusy(true);
    setPasswordMsg(null);
    const ok = await changePassword(currentPassword, newPassword);
    setPasswordMsg(ok ? { ok: true, text: 'Пароль изменён' } : { ok: false, text: 'Неверный текущий пароль' });
    if (ok) {
      setCurrentPassword('');
      setNewPassword('');
    }
    setPasswordBusy(false);
  };

  const submitName = async (): Promise<void> => {
    if (!newName.trim()) return;
    setNameBusy(true);
    setNameMsg(null);
    const ok = await changeDisplayName(newName.trim());
    if (ok) {
      renameAccount(newName.trim());
      // The new name is baked into fresh JWTs server-side; reconnect so friends/chat pick it up
      // immediately instead of waiting for the sockets' next natural reconnect.
      useSocialStore.getState().disconnect();
      useChatStore.getState().disconnect();
      void useSocialStore.getState().connect();
      void useChatStore.getState().connect();
      setNameMsg({ ok: true, text: 'Имя изменено' });
      setNewName('');
    } else {
      setNameMsg({ ok: false, text: 'Имя уже занято' });
    }
    setNameBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <label style={label}>Сменить пароль</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="password"
            placeholder="Текущий пароль"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Новый пароль"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitPassword()}
            style={inputStyle}
          />
          <button
            disabled={!currentPassword || !newPassword || passwordBusy}
            onClick={() => void submitPassword()}
            style={{ ...btn, opacity: !currentPassword || !newPassword ? 0.5 : 1 }}
          >
            {passwordBusy ? 'Сохраняем…' : 'Сменить пароль'}
          </button>
          {passwordMsg && <div style={passwordMsg.ok ? okBox : errorBox}>{passwordMsg.ok ? '✓' : '⚠'} {passwordMsg.text}</div>}
        </div>
      </div>

      <div>
        <label style={label}>Сменить имя аккаунта</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            placeholder="Новое имя"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitName()}
            style={inputStyle}
          />
          <button disabled={!newName.trim() || nameBusy} onClick={() => void submitName()} style={{ ...btn, opacity: !newName.trim() ? 0.5 : 1 }}>
            {nameBusy ? 'Сохраняем…' : 'Сменить имя'}
          </button>
          {nameMsg && <div style={nameMsg.ok ? okBox : errorBox}>{nameMsg.ok ? '✓' : '⚠'} {nameMsg.text}</div>}
        </div>
      </div>

      <button onClick={onGoToProfile} style={{ ...ghostBtn, width: '100%' }}>👤 Перейти в профиль</button>
    </div>
  );
};
