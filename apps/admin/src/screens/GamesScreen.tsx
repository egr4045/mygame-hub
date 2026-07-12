import { useEffect, useState } from 'react';
import type { ChangelogEntry, DiscussionPost, DiscussionThread } from '@mygame/protocol';
import {
  createChangelog,
  deleteChangelog,
  deletePost,
  deleteThread,
  getThread,
  listChangelog,
  listLobbies,
  listThreads,
  stopLobby,
  updateChangelog,
  type LobbyGame,
} from '../adminClient.js';
import { useToast } from '../components/ToastProvider.js';
import { ConfirmModal } from '../components/ConfirmModal.js';

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

/** Semver-aware suggestion: bump the LAST numeric segment ('1.0.3' → '1.0.4', '2' → '3'); anything
 *  non-numeric at the tail is returned untouched (the old parseInt('1.0.3') turned it into 2). */
const bumpVersion = (v: string): string => {
  const parts = v.split('.');
  const last = parts[parts.length - 1] ?? '';
  if (!/^\d+$/.test(last)) return v;
  parts[parts.length - 1] = String(parseInt(last, 10) + 1);
  return parts.join('.');
};

const ChangelogSection = ({ gameId }: { gameId: string }): JSX.Element => {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ version: '', title: '', body: '' });
  const [draft, setDraft] = useState({ version: '', title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const reload = async (): Promise<void> => {
    const list = (await listChangelog(gameId)) ?? [];
    setEntries(list);
    const nextVer = list.length > 0 ? bumpVersion(list[0]!.version) : '1.0.0';
    setDraft((d) => (d.version === '' ? { ...d, version: nextVer } : d));
  };

  useEffect(() => {
    setDraft({ version: '', title: '', body: '' });
    void reload();
    setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const publish = async (): Promise<void> => {
    if (!draft.version.trim() || !draft.title.trim() || !draft.body.trim()) return;
    setBusy(true);
    const created = await createChangelog({ gameId, ...draft });
    setBusy(false);
    if (created) {
      showToast('Запись опубликована', 'success');
      setDraft({ version: '', title: '', body: '' });
      await reload();
    } else {
      showToast('Ошибка при публикации', 'error');
    }
  };

  const startEdit = (e: ChangelogEntry): void => {
    setEditingId(e.id);
    setEdit({ version: e.version, title: e.title, body: e.body });
  };

  const saveEdit = async (id: string): Promise<void> => {
    setBusy(true);
    const updated = await updateChangelog(id, edit);
    setBusy(false);
    if (updated) {
      showToast('Изменения сохранены', 'success');
      setEditingId(null);
      await reload();
    } else {
      showToast('Ошибка при сохранении', 'error');
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    if (await deleteChangelog(id)) {
      showToast('Запись удалена', 'success');
      await reload();
    } else {
      showToast('Ошибка при удалении', 'error');
    }
    setBusy(false);
  };

  return (
    <div className="glass-card">
      <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>Ченджлог</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {entries.map((e) =>
          editingId === e.id ? (
            <div key={e.id} style={{ background: 'var(--bg-dark)', padding: 16, borderRadius: 8, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input className="input-field" value={edit.version} onChange={(ev) => setEdit({ ...edit, version: ev.target.value })} placeholder="Версия" />
              <input className="input-field" value={edit.title} onChange={(ev) => setEdit({ ...edit, title: ev.target.value })} placeholder="Заголовок" />
              <textarea className="input-field" style={{ minHeight: 80, resize: 'vertical' }} value={edit.body} onChange={(ev) => setEdit({ ...edit, body: ev.target.value })} placeholder="Текст (Markdown поддерживается)" />
              <div style={row}>
                <button className="btn" disabled={busy} onClick={() => void saveEdit(e.id)}>Сохранить</button>
                <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Отмена</button>
              </div>
            </div>
          ) : (
            <div key={e.id} style={{ background: 'var(--bg-dark)', padding: 16, borderRadius: 8, border: '1px solid rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{e.title}</strong> <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>v{e.version}</span>
                  <div style={{ color: 'var(--text-main)', fontSize: 14, marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.body}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => startEdit(e)}>Изменить</button>
                  <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: 12 }} disabled={busy} onClick={() => void remove(e.id)}>Удалить</button>
                </div>
              </div>
            </div>
          ),
        )}
        {entries.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>Записей пока нет.</div>}
      </div>

      <div style={{ background: 'var(--bg-dark)', padding: 20, borderRadius: 8, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h4 style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--text-muted)' }}>Новая запись</h4>
        <div style={{ display: 'flex', gap: 12 }}>
          <input className="input-field" style={{ width: 120 }} value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} placeholder="Версия (напр. 1.0.0)" />
          <input className="input-field" style={{ flex: 1 }} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Заголовок" />
        </div>
        <textarea className="input-field" style={{ minHeight: 80, resize: 'vertical' }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Описание изменений..." />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" disabled={busy} onClick={() => void publish()}>Опубликовать</button>
        </div>
      </div>
    </div>
  );
};

const DiscussionsSection = ({ gameId }: { gameId: string }): JSX.Element => {
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [posts, setPosts] = useState<DiscussionPost[]>([]);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  
  // Modals state
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  const reload = async (): Promise<void> => setThreads((await listThreads(gameId)) ?? []);
  useEffect(() => {
    void reload();
    setOpenId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const open = async (threadId: string): Promise<void> => {
    if (openId === threadId) {
      setOpenId(null);
      return;
    }
    const detail = await getThread(gameId, threadId);
    setPosts(detail?.posts ?? []);
    setOpenId(threadId);
  };

  const removeThread = async (threadId: string): Promise<void> => {
    setBusy(true);
    if (await deleteThread(threadId)) {
      showToast('Тред удален', 'success');
      setOpenId(null);
      await reload();
    } else {
      showToast('Ошибка при удалении треда', 'error');
    }
    setDeletingThreadId(null);
    setBusy(false);
  };

  const removePost = async (postId: string): Promise<void> => {
    setBusy(true);
    if (await deletePost(postId)) {
      showToast('Пост удален', 'success');
      if (openId) setPosts((await getThread(gameId, openId))?.posts ?? []);
      await reload();
    } else {
      showToast('Ошибка при удалении поста', 'error');
    }
    setDeletingPostId(null);
    setBusy(false);
  };

  return (
    <div className="glass-card">
      <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>Обсуждения</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {threads.map((t) => (
          <div key={t.id} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => void open(t.id)}>
                <strong style={{ fontSize: 16, color: openId === t.id ? 'var(--accent)' : '#fff' }}>{t.title}</strong>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  Автор: {t.authorName} · Ответы: {t.replyCount}
                </div>
              </div>
              <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: 12 }} disabled={busy} onClick={() => setDeletingThreadId(t.id)}>Удалить тред</button>
            </div>
            {openId === t.id && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {posts.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingLeft: 12, borderLeft: '2px solid var(--border-color)' }}>В треде пока нет ответов.</div>}
                {posts.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>{p.authorName}</div>
                      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{p.body}</div>
                    </div>
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, alignSelf: 'flex-start' }} disabled={busy} onClick={() => setDeletingPostId(p.id)}>
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {threads.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>Тредов пока нет.</div>}
      </div>

      <ConfirmModal
        isOpen={deletingThreadId !== null}
        title="Удалить тред?"
        message="Это действие удалит весь тред и все ответы в нём. Отменить будет невозможно."
        onConfirm={() => void removeThread(deletingThreadId!)}
        onCancel={() => setDeletingThreadId(null)}
        isBusy={busy}
      />
      <ConfirmModal
        isOpen={deletingPostId !== null}
        title="Удалить пост?"
        message="Пост будет удален навсегда."
        onConfirm={() => void removePost(deletingPostId!)}
        onCancel={() => setDeletingPostId(null)}
        isBusy={busy}
      />
    </div>
  );
};

const LobbySection = (): JSX.Element => {
  const [games, setGames] = useState<LobbyGame[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stoppingLobbyId, setStoppingLobbyId] = useState<string | null>(null);
  const { showToast } = useToast();

  const reload = async (): Promise<void> => setGames((await listLobbies()) ?? []);
  useEffect(() => {
    void reload();
  }, []);

  const stop = async (id: string): Promise<void> => {
    setBusyId(id);
    if (await stopLobby(id)) {
      showToast('Лобби остановлено', 'success');
      await reload();
    } else {
      showToast('Ошибка при остановке лобби', 'error');
    }
    setStoppingLobbyId(null);
    setBusyId(null);
  };

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Живые лобби</h3>
        <button className="btn btn-ghost" onClick={() => void reload()}>Обновить</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th>Игра</th>
              <th>Статус</th>
              <th>Игроков</th>
              <th style={{ textAlign: 'right' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.id}>
                <td><strong>{g.name}</strong> <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({g.id})</span></td>
                <td>
                  <span style={{ 
                    display: 'inline-block', 
                    width: 8, height: 8, 
                    borderRadius: '50%', 
                    background: g.status === 'running' ? 'var(--success)' : 'var(--text-muted)',
                    marginRight: 8
                  }} />
                  {g.status === 'running' ? 'Запущена' : 'Остановлена'}
                </td>
                <td>{g.players}</td>
                <td style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  {/* No fake success here: real lobby push needs an orchestrator→game channel that
                      doesn't exist yet. Honest disabled state until it does. */}
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 10px', fontSize: 12, opacity: 0.5, cursor: 'not-allowed' }}
                    disabled
                    title="Скоро: требует интеграции push-канала с лобби"
                  >
                    Broadcast
                  </button>
                  <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} disabled={g.status !== 'running' || busyId === g.id} onClick={() => setStoppingLobbyId(g.id)}>
                    Остановить
                  </button>
                </td>
              </tr>
            ))}
            {games.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  Оркестратор недоступен или список пуст.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        isOpen={stoppingLobbyId !== null}
        title="Остановить лобби?"
        message="Вы уверены, что хотите принудительно остановить игру? Все игроки будут отключены."
        onConfirm={() => void stop(stoppingLobbyId!)}
        onCancel={() => setStoppingLobbyId(null)}
        isBusy={busyId !== null}
      />
    </div>
  );
};

/** Games the hub registry knows today; the orchestrator's live list is merged in so a newly added
 *  game shows up here without an admin-app code change. */
const KNOWN_GAME_IDS = ['civa', 'svoyak', 'example-game', 'cards'];

export const GamesScreen = (): JSX.Element => {
  const [gameId, setGameId] = useState('civa');
  const [gameIds, setGameIds] = useState<string[]>(KNOWN_GAME_IDS);

  useEffect(() => {
    void (async () => {
      const lobbies = await listLobbies();
      if (lobbies) setGameIds([...new Set([...KNOWN_GAME_IDS, ...lobbies.map((g) => g.id)])]);
    })();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Управление играми</h2>
        <select className="input-field" style={{ minWidth: 200, fontSize: 16 }} value={gameId} onChange={(e) => setGameId(e.target.value)}>
          {gameIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>
      <ChangelogSection gameId={gameId} />
      <DiscussionsSection gameId={gameId} />
      <LobbySection />
    </div>
  );
};
