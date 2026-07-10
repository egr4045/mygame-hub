import { useEffect, useState } from 'react';
import type { AdminAccountSummary, PlatformSettingsKey } from '@mygame/protocol';
import { platformSettingsKeys } from '@mygame/protocol';
import {
  checkServicesHealth,
  getAdminRoster,
  getPlatformSettings,
  setAdminRole,
  setPlatformSetting,
  type ServiceHealth,
} from '../adminClient.js';

const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid #2a3f5a', borderRadius: 8, padding: 20 };
const input: React.CSSProperties = { background: '#171a21', border: '1px solid #2a3f5a', borderRadius: 4, padding: '8px 10px', color: '#fff' };
const btn: React.CSSProperties = { background: '#1a9fff', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const btnDanger: React.CSSProperties = { ...btn, background: '#d9534f' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', border: '1px solid #2a3f5a' };
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

const SETTING_LABELS: Record<PlatformSettingsKey, string> = {
  brand_name: 'Название платформы',
  support_email: 'Email поддержки',
  tos_url: 'Ссылка на условия использования',
};

const RosterSection = (): JSX.Element => {
  const [admins, setAdmins] = useState<AdminAccountSummary[]>([]);
  const [promoteId, setPromoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async (): Promise<void> => setAdmins((await getAdminRoster())?.admins ?? []);
  useEffect(() => {
    void reload();
  }, []);

  const promote = async (): Promise<void> => {
    if (!promoteId.trim()) return;
    setBusy(true);
    setError(null);
    const ok = await setAdminRole(promoteId.trim(), true);
    if (!ok) setError('Не удалось — проверьте ID аккаунта.');
    else setPromoteId('');
    await reload();
    setBusy(false);
  };

  const demote = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const ok = await setAdminRole(id, false);
    if (!ok) setError('Нельзя разжаловать последнего администратора.');
    await reload();
    setBusy(false);
  };

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 12px' }}>Администраторы</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {admins.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #2a3f5a', paddingTop: 6 }}>
            <span>
              {a.displayName} <span style={{ color: '#8f98a0', fontSize: 12 }}>{a.id}</span>
            </span>
            <button style={{ ...btnDanger, padding: '2px 8px', fontSize: 12 }} disabled={busy} onClick={() => void demote(a.id)}>
              Разжаловать
            </button>
          </div>
        ))}
        {admins.length === 0 && <div style={{ color: '#8f98a0' }}>Загрузка…</div>}
      </div>
      <div style={row}>
        <input style={{ ...input, flex: 1, maxWidth: 360 }} placeholder="ID аккаунта для назначения" value={promoteId} onChange={(e) => setPromoteId(e.target.value)} />
        <button style={btn} disabled={busy} onClick={() => void promote()}>
          Назначить админом
        </button>
      </div>
      {error && <div style={{ color: '#d9534f', fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
};

const HealthSection = (): JSX.Element => {
  const [health, setHealth] = useState<ServiceHealth[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = async (): Promise<void> => {
    setLoading(true);
    setHealth(await checkServicesHealth());
    setLoading(false);
  };
  useEffect(() => {
    void reload();
  }, []);

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Статус сервисов</h3>
        <button style={btnGhost} disabled={loading} onClick={() => void reload()}>
          Обновить
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {health.map((h) => (
          <div key={h.name} style={{ ...card, padding: 10, textAlign: 'center' }}>
            <div>{h.up ? '🟢' : '🔴'}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{h.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const BrandingSection = (): JSX.Element => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = async (): Promise<void> => setValues((await getPlatformSettings()) ?? {});
  useEffect(() => {
    void reload();
  }, []);

  const save = async (key: PlatformSettingsKey): Promise<void> => {
    setBusyKey(key);
    await setPlatformSetting(key, values[key] ?? '');
    await reload();
    setBusyKey(null);
  };

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 12px' }}>Брендинг и контакты</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {platformSettingsKeys.map((key) => (
          <div key={key} style={row}>
            <span style={{ color: '#8f98a0', fontSize: 13, width: 220, flexShrink: 0 }}>{SETTING_LABELS[key]}</span>
            <input
              style={{ ...input, flex: 1, minWidth: 200 }}
              value={values[key] ?? ''}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
            <button style={btn} disabled={busyKey === key} onClick={() => void save(key)}>
              Сохранить
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SettingsScreen = (): JSX.Element => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <RosterSection />
      <HealthSection />
      <BrandingSection />
    </div>
  );
};
