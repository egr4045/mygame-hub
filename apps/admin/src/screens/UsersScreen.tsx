import { useEffect, useState } from 'react';
import type { AdminAccountDetail, AdminAccountSummary } from '@mygame/protocol';
import {
  clearAvatar,
  clearWallpaper,
  getAccountDetail,
  grantAchievementTo,
  listAccounts,
  revokeAchievementFrom,
  setAccountBan,
  setAccountDisplayName,
} from '../adminClient.js';
import { useToast } from '../components/ToastProvider.js';
import { ConfirmModal } from '../components/ConfirmModal.js';

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

const LIMIT = 20;

const AccountDetail = ({ id, onBack }: { id: string; onBack: () => void }): JSX.Element => {
  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [grantForm, setGrantForm] = useState({ gameId: '', achievementId: '' });
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  
  // Modals state
  const [modalType, setModalType] = useState<'avatar' | 'wallpaper' | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = async (): Promise<void> => setDetail(await getAccountDetail(id));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!detail) return <div style={{ color: 'var(--text-muted)' }}>Загрузка…</div>;

  const doClearAvatar = async (): Promise<void> => {
    setBusy(true);
    if (await clearAvatar(id)) {
      showToast('Аватар очищен', 'success');
      await reload();
    } else {
      showToast('Ошибка при очистке аватара', 'error');
    }
    setBusy(false);
    setModalType(null);
  };
  const doClearWallpaper = async (): Promise<void> => {
    setBusy(true);
    if (await clearWallpaper(id)) {
      showToast('Обои очищены', 'success');
      await reload();
    } else {
      showToast('Ошибка при очистке обоев', 'error');
    }
    setBusy(false);
    setModalType(null);
  };
  const doGrant = async (): Promise<void> => {
    if (!grantForm.gameId.trim() || !grantForm.achievementId.trim()) return;
    setBusy(true);
    if (await grantAchievementTo(id, grantForm.gameId.trim(), grantForm.achievementId.trim())) {
      showToast('Ачивка выдана', 'success');
      setGrantForm({ gameId: '', achievementId: '' });
      await reload();
    } else {
      showToast('Не удалось выдать — проверьте ID игры и ачивки', 'error');
    }
    setBusy(false);
  };
  const doRevoke = async (gameId: string, achievementId: string): Promise<void> => {
    setBusy(true);
    if (await revokeAchievementFrom(id, gameId, achievementId)) {
      showToast('Ачивка отозвана', 'success');
      await reload();
    } else {
      showToast('Ошибка при отзыве', 'error');
    }
    setBusy(false);
  };

  const doToggleBan = async (): Promise<void> => {
    if (!detail) return;
    setBusy(true);
    const newStatus = !detail.isBanned;
    if (await setAccountBan(id, newStatus)) {
      showToast(newStatus ? 'Пользователь заблокирован' : 'Пользователь разблокирован', 'success');
      await reload();
    } else {
      showToast('Ошибка при изменении статуса блокировки', 'error');
    }
    setBusy(false);
  };

  const doChangeName = async (): Promise<void> => {
    if (!newName.trim() || newName.trim() === detail?.displayName) {
      setEditingName(false);
      return;
    }
    setBusy(true);
    if (await setAccountDisplayName(id, newName.trim())) {
      showToast('Имя изменено', 'success');
      setEditingName(false);
      await reload();
    } else {
      showToast('Имя уже занято или ошибка', 'error');
    }
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={row}>
        <button className="btn btn-ghost" onClick={onBack}>← Назад к списку</button>
      </div>

      <div className="glass-card">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: detail.avatarIcon ? `url(${detail.avatarIcon}) center/cover` : 'var(--bg-dark)',
              border: '2px solid var(--border-color)',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {editingName ? (
                <div style={row}>
                  <input className="input-field" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                  <button className="btn" disabled={busy} onClick={() => void doChangeName()}>OK</button>
                  <button className="btn btn-ghost" onClick={() => setEditingName(false)}>Отмена</button>
                </div>
              ) : (
                <div style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {detail.displayName}
                  <button className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 12 }} onClick={() => { setNewName(detail.displayName); setEditingName(true); }}>
                    ✎
                  </button>
                  {detail.isAdmin && <span style={{ color: 'var(--accent)', fontSize: 13, background: 'rgba(76, 154, 255, 0.1)', padding: '2px 8px', borderRadius: 4 }}>админ</span>}
                  {detail.isBanned && <span style={{ color: 'var(--danger)', fontSize: 13, background: 'rgba(239, 83, 80, 0.1)', padding: '2px 8px', borderRadius: 4 }}>ЗАБАНЕН</span>}
                </div>
              )}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>{detail.id}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{detail.telegramLinked ? 'Telegram привязан' : 'Telegram не привязан'}</div>
          </div>
        </div>
        <div style={{ ...row, marginTop: 16 }}>
          <button className="btn btn-danger" disabled={!detail.avatarIcon || busy} onClick={() => setModalType('avatar')}>
            Очистить аватар
          </button>
          <button className="btn btn-danger" disabled={!detail.wallpaper || busy} onClick={() => setModalType('wallpaper')}>
            Очистить обои
          </button>
          <div style={{ flex: 1 }} />
          <button className={`btn ${detail.isBanned ? 'btn-ghost' : 'btn-danger solid'}`} disabled={detail.isAdmin || busy} onClick={() => void doToggleBan()}>
            {detail.isBanned ? 'Разблокировать' : 'Заблокировать'}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={modalType !== null}
        title={modalType === 'avatar' ? 'Очистить аватар?' : 'Очистить обои?'}
        message="Пользователь потеряет текущее изображение, и оно будет заменено на стандартное."
        onConfirm={modalType === 'avatar' ? () => void doClearAvatar() : () => void doClearWallpaper()}
        onCancel={() => setModalType(null)}
        isBusy={busy}
      />

      <div className="glass-card">
        <h3 style={{ margin: '0 0 12px' }}>Статистика по играм</h3>
        {detail.stats.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>Нет данных.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '4px 8px' }}>Игра</th>
                <th style={{ padding: '4px 8px' }}>Время (сек)</th>
                <th style={{ padding: '4px 8px' }}>Последний запуск</th>
              </tr>
            </thead>
            <tbody>
              {detail.stats.map((s) => (
                <tr key={s.gameId} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '6px 8px' }}>{s.gameId}</td>
                  <td style={{ padding: '6px 8px' }}>{s.secondsPlayed}</td>
                  <td style={{ padding: '6px 8px' }}>{s.lastPlayedAt ? new Date(s.lastPlayedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="glass-card">
        <h3 style={{ margin: '0 0 12px' }}>Ачивки</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {detail.achievements.map((a) => (
            <div key={`${a.gameId}:${a.achievementId}`} style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: 6 }}>
              <span>
                {a.gameId} / {a.achievementId}
              </span>
              <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} disabled={busy} onClick={() => void doRevoke(a.gameId, a.achievementId)}>
                Забрать
              </button>
            </div>
          ))}
          {detail.achievements.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Ачивок пока нет.</div>}
        </div>
        <div style={row}>
          <input className="input-field" placeholder="ID игры" value={grantForm.gameId} onChange={(e) => setGrantForm({ ...grantForm, gameId: e.target.value })} />
          <input
            className="input-field"
            placeholder="ID ачивки"
            value={grantForm.achievementId}
            onChange={(e) => setGrantForm({ ...grantForm, achievementId: e.target.value })}
          />
          <button className="btn" disabled={busy} onClick={() => void doGrant()}>
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
  // null = loading; a failed request must not render as an honest «Ничего не найдено.»
  const [accounts, setAccounts] = useState<AdminAccountSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { showToast } = useToast();

  const reload = async (): Promise<void> => {
    setAccounts(null);
    setLoadFailed(false);
    const res = await listAccounts({ q: q || undefined, limit: LIMIT, offset });
    if (!res) {
      setLoadFailed(true);
      setAccounts([]);
      setTotal(0);
      showToast('Не удалось загрузить пользователей', 'error');
      return;
    }
    setAccounts(res.accounts);
    setTotal(res.total);
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, offset]);

  if (selectedId) return <AccountDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div className="glass-card">
      <div style={{ ...row, marginBottom: 16 }}>
        <input
          className="input-field"
          style={{ flex: 1, maxWidth: 320 }}
          placeholder="Поиск по имени или ID…"
          value={q}
          onChange={(e) => {
            setOffset(0);
            setQ(e.target.value);
          }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Всего: {total}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '4px 8px' }}>Имя</th>
              <th style={{ padding: '4px 8px' }}>Telegram</th>
              <th style={{ padding: '4px 8px' }}>Ачивок</th>
              <th style={{ padding: '4px 8px' }}>Роль</th>
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid var(--border-color)', cursor: 'pointer' }} onClick={() => setSelectedId(a.id)}>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {a.displayName}
                    {a.isBanned && <span style={{ color: 'var(--danger)', fontSize: 12 }}>[БАН]</span>}
                  </div>
                </td>
                <td style={{ padding: '6px 8px' }}>{a.telegramLinked ? '✅' : '—'}</td>
                <td style={{ padding: '6px 8px' }}>{a.achievementCount}</td>
                <td style={{ padding: '6px 8px' }}>
                  {a.isAdmin ? <span style={{ color: 'var(--accent)' }}>админ</span> : 'игрок'}
                </td>
              </tr>
            ))}
            {accounts === null && (
              <tr>
                <td colSpan={4} style={{ padding: '8px', color: 'var(--text-muted)' }}>
                  Загрузка…
                </td>
              </tr>
            )}
            {accounts !== null && accounts.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '8px', color: loadFailed ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {loadFailed ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                      Ошибка загрузки.
                      <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => void reload()}>
                        Повторить
                      </button>
                    </span>
                  ) : (
                    'Ничего не найдено.'
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ ...row, marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
          ← Назад
        </button>
        <button className="btn btn-ghost" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
          Вперёд →
        </button>
      </div>
    </div>
  );
};
