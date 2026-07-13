import { useEffect, useState } from 'react';
import type { AdminAccountSummary, PlatformSettingsKey } from '@mygame/protocol';
import {
  getAdminRoster,
  getPlatformSettings,
  setAdminRole,
  setPlatformSetting,
} from '../adminClient.js';
import { useToast } from '../components/ToastProvider.js';
import { ConfirmModal } from '../components/ConfirmModal.js';

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

/** Only the plain-text branding keys get the freeform inputs below (the game-status/sound settings
 *  have their own dedicated UIs — GamesScreen and the Sounds section here). */
const BRAND_KEYS = ['brand_name', 'support_email', 'tos_url'] as const satisfies readonly PlatformSettingsKey[];

const SETTING_LABELS: Record<(typeof BRAND_KEYS)[number], string> = {
  brand_name: 'Название платформы',
  support_email: 'Email поддержки',
  tos_url: 'Ссылка на условия использования',
};

const SOUND_DEFS = [
  { key: 'sound_message', label: '💬 Сообщение' },
  { key: 'sound_call', label: '📞 Звонок' },
  { key: 'sound_achievement', label: '🏆 Достижение' },
] as const satisfies readonly { key: PlatformSettingsKey; label: string }[];

const RosterSection = (): JSX.Element => {
  // null = loading, 'error' = the request failed — an empty roster must not look like either.
  const [admins, setAdmins] = useState<AdminAccountSummary[] | null | 'error'>(null);
  const [promoteId, setPromoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoteId, setDemoteId] = useState<string | null>(null);
  const { showToast } = useToast();

  const reload = async (): Promise<void> => {
    setAdmins(null);
    const roster = await getAdminRoster();
    setAdmins(roster ? roster.admins : 'error');
  };
  useEffect(() => {
    void reload();
  }, []);

  const promote = async (): Promise<void> => {
    if (!promoteId.trim()) return;
    setBusy(true);
    if (await setAdminRole(promoteId.trim(), true)) {
      showToast('Пользователь назначен администратором', 'success');
      setPromoteId('');
      await reload();
    } else {
      showToast('Не удалось назначить — проверьте ID аккаунта', 'error');
    }
    setBusy(false);
  };

  const demote = async (id: string): Promise<void> => {
    setBusy(true);
    if (await setAdminRole(id, false)) {
      showToast('Администратор разжалован', 'success');
      await reload();
    } else {
      showToast('Нельзя разжаловать последнего администратора', 'error');
    }
    setBusy(false);
    setDemoteId(null);
  };

  return (
    <div className="glass-card">
      <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>Администраторы</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {admins === null && <div style={{ color: 'var(--text-muted)' }}>Загрузка…</div>}
        {admins === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)' }}>
            <span>Не удалось загрузить список администраторов.</span>
            <button className="btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => void reload()}>
              Повторить
            </button>
          </div>
        )}
        {Array.isArray(admins) &&
          admins.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-dark)', padding: 12, borderRadius: 8, border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <strong style={{ fontSize: 16 }}>{a.displayName}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>{a.id}</span>
              </div>
              <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: 12 }} disabled={busy} onClick={() => setDemoteId(a.id)}>
                Разжаловать
              </button>
            </div>
          ))}
        {Array.isArray(admins) && admins.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>Пока нет ни одного администратора.</div>
        )}
      </div>
      
      <h4 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-muted)' }}>Назначить нового администратора</h4>
      <div style={row}>
        <input className="input-field" style={{ flex: 1, maxWidth: 360 }} placeholder="ID аккаунта для назначения" value={promoteId} onChange={(e) => setPromoteId(e.target.value)} />
        <button className="btn" disabled={busy} onClick={() => void promote()}>
          Назначить админом
        </button>
      </div>

      <ConfirmModal
        isOpen={demoteId !== null}
        title="Разжаловать администратора?"
        message="Пользователь потеряет доступ к панели администратора."
        onConfirm={() => void demote(demoteId!)}
        onCancel={() => setDemoteId(null)}
        isBusy={busy}
      />
    </div>
  );
};


const BrandingSection = (): JSX.Element => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { showToast } = useToast();

  const reload = async (): Promise<void> => setValues((await getPlatformSettings()) ?? {});
  useEffect(() => {
    void reload();
  }, []);

  const save = async (key: PlatformSettingsKey): Promise<void> => {
    setBusyKey(key);
    if (await setPlatformSetting(key, values[key] ?? '')) {
      showToast('Настройка сохранена', 'success');
      await reload();
    } else {
      showToast('Ошибка при сохранении', 'error');
    }
    setBusyKey(null);
  };

  return (
    <div className="glass-card">
      <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>Брендинг и контакты</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {BRAND_KEYS.map((key) => (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{SETTING_LABELS[key]}</span>
            <div style={row}>
              <input
                className="input-field"
                style={{ flex: 1, minWidth: 200 }}
                value={values[key] ?? ''}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
              <button className="btn" disabled={busyKey === key} onClick={() => void save(key)}>
                Сохранить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const SoundsSection = (): JSX.Element => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { showToast } = useToast();

  const reload = async (): Promise<void> => setValues((await getPlatformSettings()) ?? {});
  useEffect(() => {
    void reload();
  }, []);

  const save = async (key: PlatformSettingsKey, value: string): Promise<void> => {
    setBusyKey(key);
    const ok = await setPlatformSetting(key, value);
    setBusyKey(null);
    if (ok) {
      showToast(value ? 'Звук сохранён' : 'Звук сброшен на встроенный', 'success');
      await reload();
    } else {
      showToast('Не удалось сохранить (файл слишком большой?)', 'error');
    }
  };

  const onFile = (key: PlatformSettingsKey, file: File): void => {
    if (file.size > 300 * 1024) {
      showToast('Максимум 300 КБ', 'error');
      return;
    }
    const r = new FileReader();
    r.onload = () => void save(key, String(r.result));
    r.readAsDataURL(file);
  };

  const preview = (key: string): void => {
    const url = values[key];
    if (!url) return;
    try {
      void new Audio(url).play().catch(() => {});
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="glass-card">
      <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Звуки уведомлений</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 16px' }}>
        Встроены плейсхолдер-звуки. Загрузите свои (mp3/ogg/wav, до 300 КБ) — они применятся у игроков
        при следующей загрузке. Пусто — используется встроенный звук.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SOUND_DEFS.map(({ key, label }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-dark)', padding: 12, borderRadius: 8, border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, minWidth: 160 }}>{label}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 90 }}>{values[key] ? 'Свой звук' : 'Встроенный'}</span>
            <label className="btn" style={{ cursor: 'pointer', margin: 0 }}>
              Загрузить
              <input
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(key, f);
                  e.target.value = '';
                }}
              />
            </label>
            <button className="btn btn-ghost" disabled={!values[key]} onClick={() => preview(key)}>▶ Прослушать</button>
            <button className="btn btn-danger" disabled={busyKey === key || !values[key]} onClick={() => void save(key, '')}>
              Сбросить
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SettingsScreen = (): JSX.Element => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Настройки</h2>
      <RosterSection />
      <SoundsSection />
      <BrandingSection />
    </div>
  );
};
