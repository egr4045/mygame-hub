import { useEffect, useState } from 'react';
import { type GameInfo } from '../platform/games.js';
import { formatLastPlayed, formatLastReply, formatPlaytime } from '../platform/statsFormat.js';
import { routeToRoom } from '../platform/inviteRouting.js';
import {
  useSocialStore,
  useToastStore,
  getGameStats,
  getChangelog,
  getThreads,
  getThread as fetchThread,
  createThread,
  createPost,
} from '@mygame/sdk';
import type { ChangelogEntry, DiscussionPost, DiscussionThread, GameStat, social } from '@mygame/protocol';

const formatPublished = (publishedAt: number): string =>
  new Date(publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

const formatPostTime = (createdAt: number): string =>
  new Date(createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const loadErrorToast = (what: string): void =>
  useToastStore.getState().addToast({
    type: 'system',
    title: 'Ошибка загрузки',
    content: `Не удалось загрузить ${what}. Попробуйте позже.`,
    icon: '⚠️',
  });

/** Shimmer placeholder rows shown while a list is still fetching (null state). */
const SkeletonRows = ({ count = 3, height = 40 }: { count?: number; height?: number }): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="hub-skeleton" style={{ height }} />
    ))}
  </div>
);

export type GameDetailsTab = 'changelog' | 'groups' | 'discussions';

export const GameDetailsView = ({
  game,
  onPlay,
  activeTab,
  onTabChange,
}: {
  game: GameInfo | null;
  onPlay: (g: GameInfo) => void;
  activeTab: GameDetailsTab;
  onTabChange: (tab: GameDetailsTab) => void;
}): JSX.Element => {
  const [viewDiscussion, setViewDiscussion] = useState<string | null>(null);
  const [isCreatingDiscussion, setIsCreatingDiscussion] = useState(false);
  // undefined = still loading, null = loaded but no stat recorded for this game.
  const [stat, setStat] = useState<GameStat | null | undefined>(undefined);
  // For the lists: null = loading (render skeletons), [] = resolved empty (render empty copy).
  const [changelog, setChangelog] = useState<ChangelogEntry[] | null>(null);
  const [threads, setThreads] = useState<DiscussionThread[] | null>(null);
  const [threadDetail, setThreadDetail] = useState<{ thread: DiscussionThread; posts: DiscussionPost[] } | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadBody, setNewThreadBody] = useState('');
  const [replyText, setReplyText] = useState('');
  const [lobbies, setLobbies] = useState<social.Lobby[] | null>(null);
  const [newRoomName, setNewRoomName] = useState('');

  const resetSubViews = () => {
    setViewDiscussion(null);
    setIsCreatingDiscussion(false);
  };

  // Real per-game playtime/last-played, refreshed whenever the viewed game changes.
  useEffect(() => {
    setStat(undefined);
    if (!game) return;
    const gameId = game.id;
    getGameStats()
      .then((res) => setStat(res?.stats.find((s) => s.gameId === gameId) ?? null))
      .catch(() => setStat(null));
  }, [game?.id]);

  // Real changelog, refreshed whenever the viewed game changes.
  useEffect(() => {
    setChangelog(null);
    if (!game) return;
    getChangelog(game.id)
      .then(setChangelog)
      .catch(() => {
        setChangelog([]);
        loadErrorToast('обновления');
      });
  }, [game?.id]);

  // Real discussion threads; reset any open thread/create-form when the viewed game changes.
  useEffect(() => {
    setThreads(null);
    resetSubViews();
    if (!game) return;
    getThreads(game.id)
      .then(setThreads)
      .catch(() => {
        setThreads([]);
        loadErrorToast('обсуждения');
      });
  }, [game?.id]);

  // Real thread detail, refreshed whenever the open thread changes.
  useEffect(() => {
    setThreadDetail(null);
    if (!viewDiscussion || !game) return;
    void fetchThread(game.id, viewDiscussion).then(setThreadDetail);
  }, [viewDiscussion, game?.id]);

  // Live lobbies: fetched fresh whenever the tab is opened (presence isn't pushed, only queried).
  useEffect(() => {
    if (activeTab !== 'groups' || !game) return;
    setLobbies(null);
    useSocialStore
      .getState()
      .getLobbies(game.id)
      .then(setLobbies)
      .catch(() => {
        setLobbies([]);
        loadErrorToast('лобби');
      });
  }, [activeTab, game?.id]);

  const handleJoinLobby = (room: string) => {
    if (game) void routeToRoom(game, room);
  };

  const handleCreateLobby = async () => {
    if (!game || !newRoomName.trim()) return;
    const room = newRoomName.trim();
    useSocialStore.getState().setActivity({ game: game.id, gameName: game.name, room, joinable: true });
    setNewRoomName('');
    await routeToRoom(game, room);
  };

  const handleCreateThread = async () => {
    if (!game || !newThreadTitle.trim() || !newThreadBody.trim()) return;
    const created = await createThread(game.id, newThreadTitle.trim(), newThreadBody.trim());
    if (!created) return;
    setNewThreadTitle('');
    setNewThreadBody('');
    setIsCreatingDiscussion(false);
    setThreads(await getThreads(game.id));
    setViewDiscussion(created.id);
  };

  const handleReply = async () => {
    if (!game || !viewDiscussion || !replyText.trim()) return;
    const post = await createPost(viewDiscussion, replyText.trim());
    if (!post) return;
    setReplyText('');
    setThreadDetail(await fetchThread(game.id, viewDiscussion));
    setThreads(await getThreads(game.id));
  };

  if (!game) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-panel-solid)', color: 'var(--c-text-muted)' }}>
        Выберите игру из библиотеки
      </div>
    );
  }

  const playable = game.status === 'playable';

  return (
    <div style={{ flex: 1, background: 'var(--c-panel-solid)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

      {/* Hero Banner */}
      <div style={{
        height: 350,
        position: 'relative',
        background: `linear-gradient(to bottom, transparent 0%, var(--c-panel-solid) 100%), linear-gradient(135deg, ${game.accent}44 0%, var(--c-panel-solid) 100%)`,
        display: 'flex',
        alignItems: 'flex-end',
        padding: 40
      }}>
        {/* Fake Logo */}
        <div style={{ fontSize: 72, marginRight: 24, textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>{game.emoji}</div>
        <div>
          <h1 style={{ fontSize: 48, fontWeight: 800, margin: 0, color: 'var(--c-text-primary)', textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>{game.name}</h1>
        </div>
      </div>

      {/* Action Bar */}
      <div style={{ padding: '0 40px', marginTop: -20, display: 'flex', gap: 24, alignItems: 'center', position: 'relative', zIndex: 10 }}>

        {playable ? (
          <button
            onClick={() => onPlay(game)}
            style={{
              background: 'linear-gradient(to right, var(--c-accent) 0%, var(--c-accent-muted) 60%)',
              border: 'none',
              borderRadius: 4,
              padding: '12px 48px',
              color: '#fff',
              fontSize: '20px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              transition: 'transform 0.1s'
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            ИГРАТЬ
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              disabled
              className="hub-btn"
              style={{ padding: '12px 32px', fontSize: '20px' }}
            >
              {game.status === 'maintenance' ? 'НЕДОСТУПНО' : 'СКОРО ВЫЙДЕТ'}
            </button>
            {game.note && (
              <div style={{ fontSize: '12px', color: 'var(--c-text-muted)', maxWidth: 280 }}>{game.note}</div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '11px', color: 'var(--c-text-muted)', textTransform: 'uppercase' }}>ПОСЛЕДНИЙ ЗАПУСК</div>
          {stat === undefined ? (
            <div className="hub-skeleton" style={{ height: 14, width: 90 }} />
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--c-text-primary)' }}>{formatLastPlayed(stat?.lastPlayedAt ?? null)}</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '11px', color: 'var(--c-text-muted)', textTransform: 'uppercase' }}>ВРЕМЯ В ИГРЕ</div>
          {stat === undefined ? (
            <div className="hub-skeleton" style={{ height: 14, width: 60 }} />
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--c-text-primary)' }}>{formatPlaytime(stat?.secondsPlayed ?? 0, (stat?.lastPlayedAt ?? null) !== null)}</div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 32, padding: '24px 40px 0 40px', borderBottom: '1px solid var(--c-panel-border)' }}>
        {(
          [
            { id: 'changelog', label: 'Ченжлог' },
            { id: 'groups', label: 'Найти группы' },
            { id: 'discussions', label: 'Обсуждения' },
          ] satisfies { id: GameDetailsTab; label: string }[]
        ).map((tab) => (
          <div
            key={tab.id}
            onClick={() => {
              onTabChange(tab.id);
              resetSubViews();
            }}
            style={{
              fontSize: '13px',
              color: activeTab === tab.id ? 'var(--c-text-primary)' : 'var(--c-text-muted)',
              paddingBottom: 8,
              borderBottom: activeTab === tab.id ? '3px solid var(--c-accent)' : '3px solid transparent',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 600 : 400
            }}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {/* Content Body */}
      <div style={{ padding: 40, display: 'flex', gap: 40, flex: 1, flexDirection: 'column' }}>

        {activeTab === 'changelog' && (
          <div style={{ display: 'flex', gap: 40 }}>
            <div style={{ flex: 2 }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--c-text-primary)', marginBottom: 16 }}>АКТИВНОСТЬ И ОБНОВЛЕНИЯ</h2>
              {changelog === null ? (
                <SkeletonRows count={3} height={40} />
              ) : changelog.length === 0 ? (
                <div className="hub-card" style={{ padding: 24, color: 'var(--c-text-muted)', fontSize: '13px' }}>
                  Пока нет опубликованных обновлений.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {changelog.map((entry, i) => (
                    <div key={entry.id} className="hub-card" style={{ padding: 24, borderLeft: `4px solid ${i === 0 ? 'var(--c-accent)' : 'var(--c-panel-border)'}` }}>
                      <div style={{ color: i === 0 ? 'var(--c-accent)' : 'var(--c-text-primary)', fontWeight: 700, marginBottom: 8, fontSize: '18px' }}>
                        {entry.version}: {entry.title}
                      </div>
                      <div style={{ color: 'var(--c-text-muted)', fontSize: '12px', marginBottom: 16 }}>Опубликовано {formatPublished(entry.publishedAt)}</div>
                      <p style={{ color: 'var(--c-text-primary)', fontSize: '14px', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{entry.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--c-text-primary)', marginBottom: 16 }}>ДОСТИЖЕНИЯ</h2>
              <div className="hub-card" style={{ padding: 24, color: 'var(--c-text-muted)', fontSize: '13px' }}>
                Достижения пока недоступны.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'groups' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--c-text-primary)' }}>АКТИВНЫЕ ЛОББИ</h2>

            {lobbies === null ? (
              <SkeletonRows count={2} height={56} />
            ) : lobbies.length === 0 ? (
              <div className="hub-card" style={{ padding: 24, color: 'var(--c-text-muted)', fontSize: '13px' }}>
                Сейчас нет открытых лобби.
              </div>
            ) : (
              lobbies.map((lobby) => (
                <div key={lobby.room} className="hub-card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: 'var(--c-text-primary)', fontWeight: 600, fontSize: '15px' }}>{lobby.room}</div>
                    <div style={{ color: 'var(--c-text-muted)', fontSize: '12px', marginTop: 4 }}>Хост: {lobby.hostName} • {lobby.memberCount} {lobby.memberCount === 1 ? 'игрок' : 'игроков'}</div>
                  </div>
                  <button onClick={() => handleJoinLobby(lobby.room)} style={{ background: 'var(--c-positive)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Присоединиться</button>
                </div>
              ))
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <input
                placeholder="Название лобби"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                className="hub-input"
                style={{ padding: '10px 16px' }}
              />
              <button
                onClick={() => void handleCreateLobby()}
                disabled={!newRoomName.trim()}
                className="hub-btn"
                style={{ padding: '12px 16px' }}
              >
                + Создать лобби
              </button>
            </div>
          </div>
        )}

        {activeTab === 'discussions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* View Single Discussion */}
            {viewDiscussion && (
              <div className="civa-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <button onClick={() => setViewDiscussion(null)} className="hub-btn">← Назад</button>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--c-text-primary)', margin: 0 }}>{threadDetail?.thread.title ?? 'Загрузка…'}</h2>
                </div>

                {threadDetail && (
                  <>
                    <div className="hub-card" style={{ padding: 24 }}>
                      <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid var(--c-panel-border)', paddingBottom: 16, marginBottom: 16 }}>
                        <div style={{ width: 48, height: 48, background: 'var(--c-accent)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '20px', color: '#fff' }}>
                          {threadDetail.thread.authorName[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                          <div style={{ color: 'var(--c-text-primary)', fontWeight: 600, fontSize: '16px' }}>{threadDetail.thread.authorName}</div>
                          <div style={{ color: 'var(--c-text-muted)', fontSize: '12px' }}>Опубликовано {formatPostTime(threadDetail.posts[0]?.createdAt ?? threadDetail.thread.createdAt)}</div>
                        </div>
                      </div>
                      <div style={{ color: 'var(--c-text-primary)', fontSize: '15px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {threadDetail.posts[0]?.body}
                      </div>
                    </div>

                    {threadDetail.posts.length > 1 && (
                      <div style={{ paddingLeft: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {threadDetail.posts.slice(1).map((p) => (
                          <div key={p.id} className="hub-card" style={{ padding: 16, borderLeft: '2px solid var(--c-positive)' }}>
                            <div style={{ color: 'var(--c-text-primary)', fontWeight: 600, fontSize: '14px', marginBottom: 8 }}>
                              {p.authorName} <span style={{ color: 'var(--c-text-muted)', fontSize: '12px', fontWeight: 400 }}>• {formatPostTime(p.createdAt)}</span>
                            </div>
                            <div style={{ color: 'var(--c-text-primary)', fontSize: '14px', whiteSpace: 'pre-wrap' }}>{p.body}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <textarea
                        placeholder="Написать комментарий..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        className="hub-input"
                        style={{ width: '100%', height: 100, padding: 12, resize: 'vertical' }}
                      />
                      <button
                        onClick={() => void handleReply()}
                        disabled={!replyText.trim()}
                        className="hub-btn hub-btn-primary"
                        style={{ alignSelf: 'flex-end', padding: '10px 24px' }}
                      >
                        Отправить
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Create Discussion */}
            {isCreatingDiscussion && (
              <div className="civa-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <button onClick={() => setIsCreatingDiscussion(false)} className="hub-btn">← Отмена</button>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--c-text-primary)', margin: 0 }}>Создать новую тему</h2>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <input
                    placeholder="Заголовок темы (например: Как пройти уровень 4?)"
                    value={newThreadTitle}
                    onChange={(e) => setNewThreadTitle(e.target.value)}
                    className="hub-input"
                    style={{ width: '100%', padding: '12px 16px', fontSize: '16px' }}
                  />
                  <textarea
                    placeholder="Опишите вашу проблему, идею или вопрос в деталях..."
                    value={newThreadBody}
                    onChange={(e) => setNewThreadBody(e.target.value)}
                    className="hub-input"
                    style={{ width: '100%', height: 200, padding: '12px 16px', fontSize: '15px', resize: 'vertical' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
                    <button
                      onClick={() => void handleCreateThread()}
                      disabled={!newThreadTitle.trim() || !newThreadBody.trim()}
                      style={{ background: 'var(--c-positive)', color: '#fff', border: 'none', padding: '12px 32px', borderRadius: 4, fontWeight: 600, cursor: newThreadTitle.trim() && newThreadBody.trim() ? 'pointer' : 'not-allowed', fontSize: '16px', opacity: newThreadTitle.trim() && newThreadBody.trim() ? 1 : 0.5 }}
                    >
                      Опубликовать
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Discussions List */}
            {!viewDiscussion && !isCreatingDiscussion && (
              <div className="civa-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--c-text-primary)' }}>ОБСУЖДЕНИЯ</h2>
                  <button onClick={() => setIsCreatingDiscussion(true)} className="hub-btn hub-btn-primary">Новая тема</button>
                </div>

                {threads === null ? (
                  <SkeletonRows count={3} height={64} />
                ) : threads.length === 0 ? (
                  <div className="hub-card" style={{ padding: 24, color: 'var(--c-text-muted)', fontSize: '13px' }}>
                    Пока нет обсуждений. Начните первое!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {threads.map((thread, i) => (
                      <div
                        key={thread.id}
                        onClick={() => setViewDiscussion(thread.id)}
                        className="hub-card hub-row-hover"
                        style={{ padding: '16px 24px', borderLeft: `4px solid ${i === 0 ? 'var(--c-accent)' : 'var(--c-panel-border)'}`, cursor: 'pointer' }}
                      >
                        <div style={{ color: 'var(--c-text-primary)', fontWeight: 600, fontSize: '16px', marginBottom: 8 }}>{thread.title}</div>
                        <div style={{ display: 'flex', gap: 16, fontSize: '12px', color: 'var(--c-text-muted)' }}>
                          <span>Автор: {thread.authorName}</span>
                          <span>💬 {thread.replyCount} {thread.replyCount === 1 ? 'ответ' : 'ответов'}</span>
                          {thread.replyCount > 0 && (
                            <span>Последний ответ: {formatLastReply(thread.lastReplyAt)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

      </div>

    </div>
  );
};
