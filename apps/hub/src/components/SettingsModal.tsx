import { useState, type CSSProperties } from 'react';
import {
  changeDisplayName,
  changePassword,
  useNotificationPrefsStore,
  useSocialStore,
  useChatStore,
  playSound,
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
} from '@mygame/sdk';
import { usePlatformStore } from '../platform/platformStore.js';

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--c-overlay)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const card: CSSProperties = {
  width: 460,
  background: 'var(--c-panel-solid)',
  border: '1px solid var(--c-panel-border)',
  borderRadius: 8,
  padding: 32,
};

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 14px',
  borderRadius: 4,
  background: 'var(--c-panel-deep)',
  color: 'var(--c-text-primary)',
  border: '1px solid var(--c-panel-border)',
  fontSize: 13,
  outline: 'none',
};

const errorBox: CSSProperties = {
  color: 'var(--c-negative)',
  fontSize: 13,
  marginTop: 12,
  padding: '10px 12px',
  background: 'rgba(224, 82, 74, 0.12)',
  borderRadius: 4,
  textAlign: 'center',
};

const okBox: CSSProperties = { ...errorBox, color: 'var(--c-positive)', background: 'rgba(70, 196, 106, 0.12)' };

const btn: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 4,
  background: 'var(--c-accent)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  border: 'none',
  cursor: 'pointer',
};

const ghostBtn: CSSProperties = { ...btn, background: 'var(--c-panel-hover)', color: 'var(--c-text-primary)' };

const tabBtn = (active: boolean): CSSProperties => ({
  flex: 1,
  padding: '10px 0',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  color: active ? 'var(--c-text-primary)' : 'var(--c-text-muted)',
  borderBottom: active ? '2px solid var(--c-accent)' : '2px solid transparent',
});

const label: CSSProperties = { color: 'var(--c-text-muted)', fontSize: 12, marginBottom: 6, display: 'block' };
const toggleRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--c-panel-border)' };

interface Props {
  initialTab: 'notifications' | 'account';
  onClose: () => void;
  onGoToProfile: () => void;
}

export const SettingsModal = ({ initialTab, onClose, onGoToProfile }: Props): JSX.Element => {
  const [tab, setTab] = useState<'notifications' | 'account'>(initialTab);

  return (
    <div style={overlay} onClick={onClose}>
      <div className="mygame-fade-in" style={card} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ color: 'var(--c-text-primary)', margin: '0 0 16px', fontSize: 20 }}>Настройки</h2>

        <div style={{ display: 'flex', marginBottom: 20, borderBottom: '1px solid var(--c-panel-border)' }}>
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
  const messageToasts = useNotificationPrefsStore((s) => s.messageToasts);
  const systemNotifications = useNotificationPrefsStore((s) => s.systemNotifications);
  const soundVolume = useNotificationPrefsStore((s) => s.soundVolume);
  const setAchievementToasts = useNotificationPrefsStore((s) => s.setAchievementToasts);
  const setCallToasts = useNotificationPrefsStore((s) => s.setCallToasts);
  const setMessageToasts = useNotificationPrefsStore((s) => s.setMessageToasts);
  const setSystemNotifications = useNotificationPrefsStore((s) => s.setSystemNotifications);
  const setSoundVolume = useNotificationPrefsStore((s) => s.setSoundVolume);

  // Browser-permission state drives the system-notifications row: 'denied' disables the toggle with
  // a hint (irreversible from JS — only the user can re-allow in browser site settings).
  const [permission, setPermission] = useState<NotificationPermission>(notificationPermission());
  const blocked = notificationsSupported() && permission === 'denied';

  const toggleSystem = async (on: boolean): Promise<void> => {
    if (!on) {
      setSystemNotifications(false);
      return;
    }
    const p = await requestNotificationPermission();
    setPermission(p);
    setSystemNotifications(p === 'granted');
  };

  return (
    <div>
      <div style={toggleRow}>
        <span style={{ color: 'var(--c-text-primary)', fontSize: 14 }}>🏆 Тосты о новых достижениях</span>
        <input type="checkbox" checked={achievementToasts} onChange={(e) => setAchievementToasts(e.target.checked)} />
      </div>
      <div style={toggleRow}>
        <span style={{ color: 'var(--c-text-primary)', fontSize: 14 }}>📞 Тосты о входящих звонках</span>
        <input type="checkbox" checked={callToasts} onChange={(e) => setCallToasts(e.target.checked)} />
      </div>
      <div style={toggleRow}>
        <span style={{ color: 'var(--c-text-primary)', fontSize: 14 }}>💬 Всплывающие сообщения</span>
        <input type="checkbox" checked={messageToasts} onChange={(e) => setMessageToasts(e.target.checked)} />
      </div>
      <div style={{ ...toggleRow, ...(blocked || !notificationsSupported() ? { opacity: 0.6 } : {}) }}>
        <span style={{ color: 'var(--c-text-primary)', fontSize: 14 }}>
          🖥️ Системные уведомления
          <span style={{ display: 'block', color: 'var(--c-text-muted)', fontSize: 12, marginTop: 2 }}>
            {!notificationsSupported()
              ? 'Не поддерживается этим браузером'
              : blocked
                ? 'Заблокировано в браузере — разрешите уведомления для этого сайта'
                : 'Звонки и сообщения, когда вкладка не активна'}
          </span>
        </span>
        <input
          type="checkbox"
          checked={systemNotifications && permission === 'granted'}
          disabled={blocked || !notificationsSupported()}
          onChange={(e) => void toggleSystem(e.target.checked)}
        />
      </div>
      <div style={{ ...toggleRow, borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <span style={{ color: 'var(--c-text-primary)', fontSize: 14 }}>🔊 Громкость звуков: {Math.round(soundVolume * 100)}%</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(soundVolume * 100)}
            onChange={(e) => {
              setSoundVolume(Number(e.target.value) / 100);
              void playSound('message'); // preview the level as you drag
            }}
            style={{ flex: 1 }}
          />
          {/* Doubles as the audio-unlock gesture (autoplay policy) — plays one ringtone phrase. */}
          <button className="hub-btn" style={{ flexShrink: 0, padding: '4px 10px', fontSize: 12 }} onClick={() => playSound('call')}>
            ▶ Проверить
          </button>
        </div>
      </div>
      <p style={{ color: 'var(--c-text-muted)', fontSize: 12, marginTop: 16 }}>
        Хранится только в этом браузере. Звуки — плейсхолдеры (админ может заменить их своими). Заявки в
        друзья по-прежнему видны в 🔔.
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
