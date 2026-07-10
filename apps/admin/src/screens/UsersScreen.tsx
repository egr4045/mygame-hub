import { useEffect, useState } from 'react';
import type { AdminAccountDetail, AdminAccountSummary } from '@mygame/protocol';
import {
  clearAvatar,
  clearWallpaper,
  getAccountDetail,
  grantAchievementTo,
  listAccounts,
  revokeAchievementFrom,
} from '../adminClient.js';

const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid #2a3f5a', borderRadius: 8, padding: 20 };
const input: React.CSSProperties = { background: '#171a21', border: '1px solid #2a3f5a', borderRadius: 4, padding: '8px 10px', color: '#fff' };
const btn: React.CSSProperties = { background: '#1a9fff', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const btnDanger: React.CSSProperties = { ...btn, background: '#d9534f' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', border: '1px solid #2a3f5a' };
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

const LIMIT = 20;

const AccountDetail = ({ id, onBack }: { id: string; onBack: () => void }): JSX.Element => {
  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [grantForm, setGrantForm] = useState({ gameId: '', achievementId: '' });
  const [busy, setBusy] = useState(false);

  const reload = async (): Promise<void> => setDetail(await getAccountDetail(id));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!detail) return <div style={{ color: '#8f98a0' }}>Загрузка…</div>;

  const doClearAvatar = async (): Promise<void> => {
    setBusy(true);
    await clearAvatar(id);
    await reload();
    setBusy(false);
  };
  const doClearWallpaper = async (): Promise<void> => {
    setBusy(true);
    await clearWallpaper(id);
    await reload();
    setBusy(false);
  };
  const doGrant = async (): Promise<void> => {
    if (!grantForm.gameId.trim() || !grantForm.achievementId.trim()) return;
    setBusy(true);
    await grantAchievementTo(id, grantForm.gameId.trim(), grantForm.achievementId.trim());
    setGrantForm({ gameId: '', achievementId: '' });
    await reload();
    setBusy(false);
  };
  const doRevoke = async (gameId: string, achievementId: string): Promise<void> => {
    setBusy(true);
    await revokeAchievementFrom(id, gameId, achievementId);
    await reload();
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={row}>
        <button style={btnGhost} onClick={onBack}>← Назад к списку</button>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: detail.avatarIcon ? `url(${detail.avatarIcon}) center/cover` : '#2a3f5a',
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {detail.displayName} {detail.isAdmin && <span style={{ color: '#1a9fff', fontSize: 13 }}>· админ</span>}
            </div>
            <div style={{ color: '#8f98a0', fontSize: 13 }}>{detail.id}</div>
            <div style={{ color: '#8f98a0', fontSize: 13 }}>{detail.telegramLinked ? 'Telegram привязан' : 'Telegram не привязан'}</div>
          </div>
        </div>
        <div style={{ ...row, marginTop: 12 }}>
          <button style={btnDanger} disabled={!detail.avatarIcon || busy} onClick={() => void doClearAvatar()}>
            Очистить аватар
          </button>
          <button style={btnDanger} disabled={!detail.wallpaper || busy} onClick={() => void doClearWallpaper()}>
            Очистить обои
          </button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 12px' }}>Статистика по играм</h3>
        {detail.stats.length === 0 ? (
          <div style={{ color: '#8f98a0' }}>Нет данных.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#8f98a0' }}>
                <th style={{ padding: '4px 8px' }}>Игра</th>
                <th style={{ padding: '4px 8px' }}>Время (сек)</th>
                <th style={{ padding: '4px 8px' }}>Последний запуск</th>
              </tr>
            </thead>
            <tbody>
              {detail.stats.map((s) => (
                <tr key={s.gameId} style={{ borderTop: '1px solid #2a3f5a' }}>
                  <td style={{ padding: '6px 8px' }}>{s.gameId}</td>
                  <td style={{ padding: '6px 8px' }}>{s.secondsPlayed}</td>
                  <td style={{ padding: '6px 8px' }}>{s.lastPlayedAt ? new Date(s.lastPlayedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 12px' }}>Ачивки</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {detail.achievements.map((a) => (
            <div key={`${a.gameId}:${a.achievementId}`} style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #2a3f5a', paddingTop: 6 }}>
              <span>
                {a.gameId} / {a.achievementId}
              </span>
              <button style={{ ...btnGhost, padding: '2px 8px', fontSize: 12 }} disabled={busy} onClick={() => void doRevoke(a.gameId, a.achievementId)}>
                Забрать
              </button>
            </div>
          ))}
          {detail.achievements.length === 0 && <div style={{ color: '#8f98a0' }}>Ачивок пока нет.</div>}
        </div>
        <div style={row}>
          <input style={input} placeholder="ID игры" value={grantForm.gameId} onChange={(e) => setGrantForm({ ...grantForm, gameId: e.target.value })} />
          <input
            style={input}
            placeholder="ID ачивки"
            value={grantForm.achievementId}
            onChange={(e) => setGrantForm({ ...grantForm, achievementId: e.target.value })}
          />
          <button style={btn} disabled={busy} onClick={() => void doGrant()}>
            Выдать
          </button>
        </div>
      </div>
    </div>
  );
};

export const UsersScreen = (): JSX.Element => {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    const res = await listAccounts({ q: q || undefined, limit: LIMIT, offset });
    setAccounts(res?.accounts ?? []);
    setTotal(res?.total ?? 0);
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, offset]);

  if (selectedId) return <AccountDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div style={card}>
      <div style={{ ...row, marginBottom: 16 }}>
        <input
          style={{ ...input, flex: 1, maxWidth: 320 }}
          placeholder="Поиск по имени или ID…"
          value={q}
          onChange={(e) => {
            setOffset(0);
            setQ(e.target.value);
          }}
        />
        <span style={{ color: '#8f98a0', fontSize: 13 }}>Всего: {total}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#8f98a0' }}>
            <th style={{ padding: '4px 8px' }}>Имя</th>
            <th style={{ padding: '4px 8px' }}>Telegram</th>
            <th style={{ padding: '4px 8px' }}>Ачивок</th>
            <th style={{ padding: '4px 8px' }}>Роль</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} style={{ borderTop: '1px solid #2a3f5a', cursor: 'pointer' }} onClick={() => setSelectedId(a.id)}>
              <td style={{ padding: '6px 8px' }}>{a.displayName}</td>
              <td style={{ padding: '6px 8px' }}>{a.telegramLinked ? '✅' : '—'}</td>
              <td style={{ padding: '6px 8px' }}>{a.achievementCount}</td>
              <td style={{ padding: '6px 8px' }}>{a.isAdmin ? 'админ' : 'игрок'}</td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: '8px', color: '#8f98a0' }}>
                Ничего не найдено.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ ...row, marginTop: 12, justifyContent: 'flex-end' }}>
        <button style={btnGhost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
          ← Назад
        </button>
        <button style={btnGhost} disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
          Вперёд →
        </button>
      </div>
    </div>
  );
};
