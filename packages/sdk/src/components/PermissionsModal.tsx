/**
 * «Права и устройства» — the one place a player checks and grants everything calls/notifications
 * need: microphone, camera, system notifications, sound (autoplay unlock), plus default-device
 * pickers (mic/cam/speaker, persisted to the same keys the in-call DeviceMenu and `createCallRoom`
 * use). Closable and optional; hosts reopen it via `usePermissionsModal.getState().show()`.
 *
 * Statuses come from the Permissions API where available (Chromium); Safari/Firefox fall back to
 * «not asked yet» and the Запросить button resolves the truth via a real getUserMedia. When a
 * permission is hard-blocked, the row shows platform-specific (iOS / Android / Windows / macOS)
 * instructions for unblocking it manually — a JS request can never un-deny.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { mg } from '../theme/tokens.js';
import { btn, surfaceWindow } from '../theme/primitives.js';
import { DEVICE_KEYS } from './call/DeviceMenu.js';
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
} from '../notifications.js';
import { useNotificationPrefsStore } from '../state/notificationPrefsStore.js';
import { isAudioReady, playSound } from '../sound.js';
import { loadJson, saveJson } from '../utils/storage.js';

/* ------------------------------------------------------------------ open/close (host-triggered) */

interface PermissionsModalState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const usePermissionsModal = create<PermissionsModalState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/* ------------------------------------------------------------------------- platform detection */

type Platform = 'ios' | 'android' | 'windows' | 'mac' | 'other';

const detectPlatform = (): Platform => {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  // iPadOS 13+ masquerades as macOS — the touch-points check catches it.
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac/.test(ua)) return 'mac';
  return 'other';
};

/** Standalone PWA (added to home screen) — the only mode where iOS supports Web Notifications. */
const isStandalone = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true);

const MEDIA_HINTS: Record<Platform, string> = {
  windows:
    'Нажмите на значок 🔒 (или настроек) слева от адреса сайта → Настройки сайтов → разрешите «Микрофон» и «Камера». Если браузеру вообще запрещён доступ: Параметры Windows → Конфиденциальность и защита → Микрофон / Камера → включите доступ для приложений и браузера.',
  android:
    'Нажмите 🔒 (или ⓘ) рядом с адресом → Разрешения → включите «Микрофон» и «Камера». Если пункта нет: Настройки Android → Приложения → ваш браузер → Разрешения.',
  ios: 'Откройте Настройки iPhone/iPad → найдите Safari (или ваш браузер) → Микрофон и Камера → «Разрешить». Для конкретного сайта: в Safari нажмите «АА» в адресной строке → «Настройки для этого веб-сайта».',
  mac: 'Нажмите на значок 🔒 у адреса → разрешите доступ. Если устройств не видно: Системные настройки → Конфиденциальность и безопасность → Микрофон / Камера → включите для браузера.',
  other:
    'Нажмите на значок 🔒 рядом с адресом сайта и разрешите доступ к микрофону и камере в настройках сайта.',
};

const NOTIF_HINTS: Record<Platform, string> = {
  windows:
    'Нажмите 🔒 у адреса → Уведомления → «Разрешить». Затем проверьте, что уведомления браузера не выключены в Windows: Параметры → Система → Уведомления.',
  android:
    'Нажмите 🔒 у адреса → Уведомления → «Разрешить». Если не помогает: Настройки Android → Приложения → браузер → Уведомления.',
  ios: 'В Safari уведомления работают только у сайта, добавленного на экран «Домой»: Поделиться → «На экран “Домой”». Затем откройте GAMEHUB с главного экрана и разрешите уведомления здесь.',
  mac: 'Нажмите 🔒 у адреса → Уведомления → «Разрешить». Затем проверьте Системные настройки → Уведомления → ваш браузер.',
  other: 'Разрешите уведомления для этого сайта в настройках браузера (значок 🔒 рядом с адресом).',
};

/* ------------------------------------------------------------------------------ status model */

type PermState = 'granted' | 'prompt' | 'denied' | 'unsupported' | 'nodevice';

const queryPermission = async (name: string): Promise<PermState | 'unknown'> => {
  try {
    const st = await navigator.permissions.query({ name: name as PermissionName });
    return st.state as PermState;
  } catch {
    return 'unknown'; // Safari/Firefox don't expose mic/cam here — the request button finds out
  }
};

const requestMedia = async (kind: 'mic' | 'cam'): Promise<PermState> => {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'mic' ? { audio: true } : { video: true });
    stream.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch (e) {
    const name = (e as DOMException | undefined)?.name;
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'nodevice';
    return 'denied';
  }
};

const STATUS_LABEL: Record<PermState, { text: string; color: 'positive' | 'muted' | 'danger' | 'warning' }> = {
  granted: { text: 'Разрешено', color: 'positive' },
  prompt: { text: 'Не запрошено', color: 'muted' },
  denied: { text: 'Заблокировано', color: 'danger' },
  unsupported: { text: 'Недоступно', color: 'muted' },
  nodevice: { text: 'Нет устройства', color: 'warning' },
};

const StatusChip = ({ state }: { state: PermState }): JSX.Element => {
  const s = STATUS_LABEL[state];
  const color =
    s.color === 'positive' ? mg.positive : s.color === 'danger' ? mg.danger : s.color === 'warning' ? mg.warning : mg.textMuted;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 800,
        color,
        border: `1px solid ${color}`,
        borderRadius: mg.rPill,
        padding: '2px 9px',
        whiteSpace: 'nowrap',
        opacity: 0.95,
      }}
    >
      {state === 'granted' ? '✓ ' : ''}
      {s.text}
    </span>
  );
};

/* ------------------------------------------------------------------------------------ rows UI */

const Row = ({
  icon,
  title,
  desc,
  state,
  hint,
  actionLabel,
  onAction,
}: {
  icon: string;
  title: string;
  desc: string;
  state: PermState;
  /** Manual-unblock instructions shown when denied/unsupported. */
  hint?: string | undefined;
  actionLabel?: string;
  onAction?: (() => void) | undefined;
}): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderBottom: `1px solid ${mg.border}` }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 20, width: 26, textAlign: 'center', flexShrink: 0 }} aria-hidden>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: mg.text }}>{title}</div>
        <div style={{ fontSize: 12, color: mg.textMuted, marginTop: 1 }}>{desc}</div>
      </div>
      <StatusChip state={state} />
      {onAction && (state === 'prompt' || state === 'nodevice') && (
        <button onClick={onAction} style={{ ...btn('primary'), flexShrink: 0 }}>
          {actionLabel ?? 'Запросить'}
        </button>
      )}
    </div>
    {(state === 'denied' || state === 'unsupported') && hint && (
      <div
        style={{
          marginLeft: 38,
          fontSize: 12,
          lineHeight: 1.5,
          color: mg.textMuted,
          background: mg.surfaceDeep,
          border: `1px solid ${mg.border}`,
          borderRadius: mg.rMd,
          padding: '8px 12px',
        }}
      >
        💡 {hint}
      </div>
    )}
  </div>
);

/* ------------------------------------------------------------------------- device preferences */

const savedDevice = (key: string): string => loadJson<string | null>(key, null) ?? '';

const DeviceSelect = ({
  label,
  devices,
  storageKey,
  disabledHint,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  storageKey: string;
  disabledHint?: string | undefined;
}): JSX.Element => {
  const [value, setValue] = useState(() => savedDevice(storageKey));
  const usable = devices.filter((d) => d.deviceId);
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: mg.textMuted }}>
        {label}
      </span>
      <select
        value={value}
        disabled={usable.length === 0}
        onChange={(e) => {
          setValue(e.target.value);
          // Empty string = «системное по умолчанию» — drop the override entirely.
          if (e.target.value) saveJson(storageKey, e.target.value);
          else
            try {
              localStorage.removeItem(storageKey);
            } catch {
              /* ignore */
            }
        }}
        style={{
          background: mg.surfaceDeep,
          color: mg.text,
          border: `1px solid ${mg.border}`,
          borderRadius: mg.rSm,
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: mg.font,
          outline: 'none',
        }}
      >
        <option value="">По умолчанию (системное)</option>
        {usable.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
      {usable.length === 0 && disabledHint && (
        <span style={{ fontSize: 11, color: mg.textMuted }}>{disabledHint}</span>
      )}
    </label>
  );
};

/* -------------------------------------------------------------------------------- the modal */

export const PermissionsModal = (): JSX.Element | null => {
  const open = usePermissionsModal((s) => s.open);
  const hide = usePermissionsModal((s) => s.hide);
  const setSystemNotifications = useNotificationPrefsStore((s) => s.setSystemNotifications);

  const platform = detectPlatform();
  const [mic, setMic] = useState<PermState>('prompt');
  const [cam, setCam] = useState<PermState>('prompt');
  const [notif, setNotif] = useState<PermState>('prompt');
  const [sound, setSound] = useState<PermState>('prompt');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const refreshDevices = async (): Promise<void> => {
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {
      setDevices([]);
    }
  };

  const refreshAll = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMic('unsupported');
      setCam('unsupported');
    } else {
      const m = await queryPermission('microphone');
      const c = await queryPermission('camera');
      setMic(m === 'unknown' ? 'prompt' : m);
      setCam(c === 'unknown' ? 'prompt' : c);
    }
    if (!notificationsSupported()) setNotif('unsupported');
    else {
      const p = notificationPermission();
      setNotif(p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt');
    }
    setSound(isAudioReady() ? 'granted' : 'prompt');
    void refreshDevices();
  };

  useEffect(() => {
    if (!open) return undefined;
    void refreshAll();
    const onDeviceChange = (): void => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    // Sound unlocks from ANY gesture (incl. clicks inside this window) — poll while open.
    const soundPoll = setInterval(() => {
      if (isAudioReady()) setSound('granted');
    }, 600);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      clearInterval(soundPoll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const requestMic = async (): Promise<void> => {
    setMic(await requestMedia('mic'));
    void refreshDevices(); // labels appear once permission is granted
  };
  const requestCam = async (): Promise<void> => {
    setCam(await requestMedia('cam'));
    void refreshDevices();
  };
  const requestNotif = async (): Promise<void> => {
    const p = await requestNotificationPermission();
    setNotif(p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt');
    if (p === 'granted') setSystemNotifications(true); // asking from here means «I want them»
  };
  const unlockSound = (): void => {
    playSound('call'); // the click itself is the unlocking gesture
    setTimeout(() => setSound(isAudioReady() ? 'granted' : 'prompt'), 200);
  };

  const iosNotifUnsupported = platform === 'ios' && !isStandalone() && !notificationsSupported();
  const mediaGranted = mic === 'granted' || cam === 'granted';

  return (
    <div
      onClick={hide}
      style={{
        position: 'fixed',
        inset: 0,
        background: mg.overlay,
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        pointerEvents: 'auto',
      }}
    >
      <div
        className="mygame-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...surfaceWindow,
          width: 560,
          maxWidth: '100%',
          maxHeight: 'min(720px, 92dvh)',
          overflowY: 'auto',
          padding: '26px 28px calc(20px + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, color: mg.text }}>🎛️ Права и устройства</h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5, color: mg.textMuted }}>
              Чтобы звонки, сообщения и уведомления работали как надо, дайте браузеру доступ.
              Это необязательно, но без прав звонок молчит, а уведомления не приходят. Окно всегда
              можно открыть снова из настроек.
            </p>
          </div>
          <button
            onClick={hide}
            aria-label="Закрыть"
            style={{ background: 'transparent', border: 'none', color: mg.textMuted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4, flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <Row
            icon="🎤"
            title="Микрофон"
            desc="Голос в звонках"
            state={mic}
            hint={MEDIA_HINTS[platform]}
            onAction={() => void requestMic()}
          />
          <Row
            icon="📷"
            title="Камера"
            desc="Видео в звонках"
            state={cam}
            hint={MEDIA_HINTS[platform]}
            onAction={() => void requestCam()}
          />
          <Row
            icon="🔔"
            title="Уведомления"
            desc="Звонки и сообщения, когда вкладка не активна"
            state={iosNotifUnsupported ? 'unsupported' : notif}
            hint={NOTIF_HINTS[platform]}
            onAction={() => void requestNotif()}
          />
          <Row
            icon="🔊"
            title="Звук"
            desc="Рингтон и звуки сообщений (браузер глушит звук до первого клика)"
            state={sound}
            actionLabel="Включить"
            onAction={unlockSound}
          />
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: mg.text }}>Устройства по умолчанию</div>
          <p style={{ margin: '4px 0 10px', fontSize: 12, color: mg.textMuted }}>
            {mediaGranted
              ? 'Применятся к следующему звонку; во время звонка их можно сменить через ⚙️.'
              : 'Названия устройств появятся после разрешения микрофона или камеры.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <DeviceSelect
              label="Микрофон"
              devices={devices.filter((d) => d.kind === 'audioinput')}
              storageKey={DEVICE_KEYS.mic}
              disabledHint="Нет доступных микрофонов"
            />
            <DeviceSelect
              label="Камера"
              devices={devices.filter((d) => d.kind === 'videoinput')}
              storageKey={DEVICE_KEYS.cam}
              disabledHint="Нет доступных камер"
            />
            <DeviceSelect
              label="Динамик"
              devices={devices.filter((d) => d.kind === 'audiooutput')}
              storageKey={DEVICE_KEYS.speaker}
              disabledHint={platform === 'ios' ? 'iOS не даёт выбирать динамик из браузера' : 'Нет доступных динамиков'}
            />
          </div>
        </div>

        <button onClick={hide} style={{ ...btn('neutral'), marginTop: 20, padding: '10px' }}>
          Готово
        </button>
      </div>
    </div>
  );
};
