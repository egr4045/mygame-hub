import { useEffect, useState } from 'react';
import { checkServicesHealth, listLobbies, listAccounts, type ServiceHealth, type LobbyGame } from '../adminClient.js';
import { useToast } from '../components/ToastProvider.js';

export const DashboardScreen = (): JSX.Element => {
  const [health, setHealth] = useState<ServiceHealth[]>([]);
  const [lobbies, setLobbies] = useState<LobbyGame[] | null>(null);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const reload = async (): Promise<void> => {
    setLoading(true);
    const [hRes, lRes, uRes] = await Promise.all([
      checkServicesHealth(),
      listLobbies(),
      listAccounts({ limit: 1, offset: 0 }),
    ]);
    setHealth(hRes);
    setLobbies(lRes ?? []);
    setTotalUsers(uRes?.total ?? null);
    // Silent zeros hide a dead service — say which fetches actually failed.
    if (lRes === null || !uRes) {
      showToast(
        `Не удалось загрузить: ${[lRes === null ? 'лобби' : null, !uRes ? 'пользователей' : null].filter(Boolean).join(', ')}`,
        'error',
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeLobbies = lobbies === null ? '…' : lobbies.filter((l) => l.status === 'running').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Дашборд</h2>
        <button className="btn btn-ghost" disabled={loading} onClick={() => void reload()}>
          Обновить
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div className="glass-card">
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Пользователей
          </div>
          <div style={{ fontSize: 32, fontWeight: 800 }}>{totalUsers ?? '…'}</div>
        </div>

        <div className="glass-card">
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Активных Лобби
          </div>
          <div style={{ fontSize: 32, fontWeight: 800 }}>{activeLobbies}</div>
        </div>

        <div className="glass-card">
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Сервисов онлайн
          </div>
          <div style={{ fontSize: 32, fontWeight: 800 }}>
            {health.filter(h => h.up).length} / {health.length}
          </div>
        </div>
      </div>

      <div className="glass-card">
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Статус сервисов</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {health.map((h) => (
            <div key={h.name} style={{
              background: 'var(--bg-dark)',
              border: `1px solid ${h.up ? 'rgba(63, 206, 122, 0.2)' : 'rgba(239, 83, 80, 0.2)'}`,
              borderRadius: 8,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12
            }}>
              <div style={{ fontSize: 16 }}>{h.up ? '🟢' : '🔴'}</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{h.name}</div>
            </div>
          ))}
          {health.length === 0 && loading && <div style={{ color: 'var(--text-muted)' }}>Загрузка…</div>}
          {health.length === 0 && !loading && <div style={{ color: 'var(--text-muted)' }}>Нет данных</div>}
        </div>
      </div>
    </div>
  );
};
