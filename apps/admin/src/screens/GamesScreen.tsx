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

const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid #2a3f5a', borderRadius: 8, padding: 20 };
const input: React.CSSProperties = { background: '#171a21', border: '1px solid #2a3f5a', borderRadius: 4, padding: '8px 10px', color: '#fff' };
const btn: React.CSSProperties = { background: '#1a9fff', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const btnDanger: React.CSSProperties = { ...btn, background: '#d9534f' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', border: '1px solid #2a3f5a' };
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

const ChangelogSection = ({ gameId }: { gameId: string }): JSX.Element => {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ version: '', title: '', body: '' });
  const [draft, setDraft] = useState({ version: '', title: '', body: '' });
  const [busy, setBusy] = useState(false);

  const reload = async (): Promise<void> => setEntries((await listChangelog(gameId)) ?? []);
  useEffect(() => {
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
      setDraft({ version: '', title: '', body: '' });
      await reload();
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
      setEditingId(null);
      await reload();
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    await deleteChangelog(id);
    setBusy(false);
    await reload();
  };

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 12px' }}>Ченджлог — {gameId}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {entries.map((e) =>
          editingId === e.id ? (
            <div key={e.id} style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input style={input} value={edit.version} onChange={(ev) => setEdit({ ...edit, version: ev.target.value })} placeholder="Версия" />
              <input style={input} value={edit.title} onChange={(ev) => setEdit({ ...edit, title: ev.target.value })} placeholder="Заголовок" />
              <textarea style={{ ...input, minHeight: 60 }} value={edit.body} onChange={(ev) => setEdit({ ...edit, body: ev.target.value })} placeholder="Текст" />
              <div style={row}>
                <button style={btn} disabled={busy} onClick={() => void saveEdit(e.id)}>Сохранить</button>
                <button style={btnGhost} onClick={() => setEditingId(null)}>Отмена</button>
              </div>
            </div>
          ) : (
            <div key={e.id} style={{ ...card, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <strong>{e.title}</strong> <span style={{ color: '#8f98a0' }}>v{e.version}</span>
                  <div style={{ color: '#8f98a0', fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap' }}>{e.body}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button style={btnGhost} onClick={() => startEdit(e)}>Изменить</button>
                  <button style={btnDanger} disabled={busy} onClick={() => void remove(e.id)}>Удалить</button>
                </div>
              </div>
            </div>
          ),
        )}
        {entries.length === 0 && <div style={{ color: '#8f98a0' }}>Записей пока нет.</div>}
      </div>

      <div style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={row}>
          <input style={{ ...input, width: 100 }} value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} placeholder="Версия" />
          <input style={{ ...input, flex: 1 }} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Заголовок" />
        </div>
        <textarea style={{ ...input, minHeight: 60 }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Текст записи" />
        <button style={btn} disabled={busy} onClick={() => void publish()}>Опубликовать</button>
      </div>
    </div>
  );
};

const DiscussionsSection = ({ gameId }: { gameId: string }): JSX.Element => {
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [posts, setPosts] = useState<DiscussionPost[]>([]);
  const [busy, setBusy] = useState(false);

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
    await deleteThread(threadId);
    setBusy(false);
    setOpenId(null);
    await reload();
  };

  const removePost = async (postId: string): Promise<void> => {
    setBusy(true);
    await deletePost(postId);
    if (openId) setPosts((await getThread(gameId, openId))?.posts ?? []);
    await reload(); // also refreshes the thread's replyCount shown in the list above
    setBusy(false);
  };

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 12px' }}>Обсуждения — {gameId}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {threads.map((t) => (
          <div key={t.id} style={{ ...card, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ cursor: 'pointer' }} onClick={() => void open(t.id)}>
                <strong>{t.title}</strong>
                <div style={{ color: '#8f98a0', fontSize: 13 }}>
                  {t.authorName} · {t.replyCount} ответ(ов)
                </div>
              </div>
              <button style={btnDanger} disabled={busy} onClick={() => void removeThread(t.id)}>Удалить тред</button>
            </div>
            {openId === t.id && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {posts.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px solid #2a3f5a', paddingTop: 6 }}>
                    <div>
                      <span style={{ color: '#8f98a0', fontSize: 12 }}>{p.authorName}:</span> {p.body}
                    </div>
                    <button style={{ ...btnGhost, padding: '2px 8px', fontSize: 12 }} disabled={busy} onClick={() => void removePost(p.id)}>
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {threads.length === 0 && <div style={{ color: '#8f98a0' }}>Тредов пока нет.</div>}
      </div>
    </div>
  );
};

const LobbySection = (): JSX.Element => {
  const [games, setGames] = useState<LobbyGame[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async (): Promise<void> => setGames((await listLobbies()) ?? []);
  useEffect(() => {
    void reload();
  }, []);

  const stop = async (id: string): Promise<void> => {
    setBusyId(id);
    await stopLobby(id);
    await reload();
    setBusyId(null);
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Живые лобби</h3>
        <button style={btnGhost} onClick={() => void reload()}>Обновить</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#8f98a0' }}>
            <th style={{ padding: '4px 8px' }}>Игра</th>
            <th style={{ padding: '4px 8px' }}>Статус</th>
            <th style={{ padding: '4px 8px' }}>Игроков</th>
            <th style={{ padding: '4px 8px' }} />
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr key={g.id} style={{ borderTop: '1px solid #2a3f5a' }}>
              <td style={{ padding: '6px 8px' }}>{g.name}</td>
              <td style={{ padding: '6px 8px' }}>{g.status === 'running' ? '🟢 запущена' : '⚪ остановлена'}</td>
              <td style={{ padding: '6px 8px' }}>{g.players}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                <button style={btnDanger} disabled={g.status !== 'running' || busyId === g.id} onClick={() => void stop(g.id)}>
                  Остановить
                </button>
              </td>
            </tr>
          ))}
          {games.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: '8px', color: '#8f98a0' }}>
                Оркестратор недоступен или список пуст.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export const GamesScreen = (): JSX.Element => {
  const [gameId, setGameId] = useState('civa');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={row}>
        <span style={{ color: '#8f98a0', fontSize: 13 }}>ID игры:</span>
        <input style={input} value={gameId} onChange={(e) => setGameId(e.target.value)} />
      </div>
      <ChangelogSection gameId={gameId} />
      <DiscussionsSection gameId={gameId} />
      <LobbySection />
    </div>
  );
};
