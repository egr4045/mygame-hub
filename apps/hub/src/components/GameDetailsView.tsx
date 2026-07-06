import { useEffect, useState } from 'react';
import { type GameInfo } from '../platform/games.js';
import { formatLastPlayed, formatPlaytime } from '../platform/statsFormat.js';
import { routeToRoom } from '../platform/inviteRouting.js';
import {
  useSocialStore,
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
  const [stat, setStat] = useState<GameStat | null>(null);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [threadDetail, setThreadDetail] = useState<{ thread: DiscussionThread; posts: DiscussionPost[] } | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadBody, setNewThreadBody] = useState('');
  const [replyText, setReplyText] = useState('');
  const [lobbies, setLobbies] = useState<social.Lobby[]>([]);
  const [newRoomName, setNewRoomName] = useState('');

  const resetSubViews = () => {
    setViewDiscussion(null);
    setIsCreatingDiscussion(false);
  };

  // Real per-game playtime/last-played, refreshed whenever the viewed game changes.
  useEffect(() => {
    setStat(null);
    if (!game) return;
    const gameId = game.id;
    void getGameStats().then((res) => {
      setStat(res?.stats.find((s) => s.gameId === gameId) ?? null);
    });
  }, [game?.id]);

  // Real changelog, refreshed whenever the viewed game changes.
  useEffect(() => {
    setChangelog([]);
    if (!game) return;
    void getChangelog(game.id).then(setChangelog);
  }, [game?.id]);

  // Real discussion threads; reset any open thread/create-form when the viewed game changes.
  useEffect(() => {
    setThreads([]);
    resetSubViews();
    if (!game) return;
    void getThreads(game.id).then(setThreads);
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
    void useSocialStore.getState().getLobbies(game.id).then(setLobbies);
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
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1b2838', color: '#6c7784' }}>
        Выберите игру из библиотеки
      </div>
    );
  }

  const playable = game.status === 'playable';

  return (
    <div style={{ flex: 1, background: '#1b2838', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      
      {/* Hero Banner */}
      <div style={{ 
        height: 350, 
        position: 'relative', 
        background: `linear-gradient(to bottom, transparent 0%, #1b2838 100%), linear-gradient(135deg, ${game.accent}44 0%, #1b2838 100%)`,
        display: 'flex',
        alignItems: 'flex-end',
        padding: 40
      }}>
        {/* Fake Logo */}
        <div style={{ fontSize: 72, marginRight: 24, textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>{game.emoji}</div>
        <div>
          <h1 style={{ fontSize: 48, fontWeight: 800, margin: 0, color: '#fff', textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>{game.name}</h1>
        </div>
      </div>

      {/* Action Bar */}
      <div style={{ padding: '0 40px', marginTop: -20, display: 'flex', gap: 24, alignItems: 'center', position: 'relative', zIndex: 10 }}>
        
        {playable ? (
          <button 
            onClick={() => onPlay(game)}
            style={{ 
              background: 'linear-gradient(to right, #47bfff 0%, #1a44c2 60%)', 
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
          <button 
            disabled
            style={{ 
              background: '#3d4450', 
              border: 'none', 
              borderRadius: 4, 
              padding: '12px 32px', 
              color: '#6c7784', 
              fontSize: '20px', 
              fontWeight: 600, 
            }}
          >
            СКОРО ВЫЙДЕТ
          </button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '11px', color: '#8f98a0', textTransform: 'uppercase' }}>ПОСЛЕДНИЙ ЗАПУСК</div>
          <div style={{ fontSize: '13px', color: '#dcdedf' }}>{formatLastPlayed(stat?.lastPlayedAt ?? null)}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '11px', color: '#8f98a0', textTransform: 'uppercase' }}>ВРЕМЯ В ИГРЕ</div>
          <div style={{ fontSize: '13px', color: '#dcdedf' }}>{formatPlaytime(stat?.secondsPlayed ?? 0)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 32, padding: '24px 40px 0 40px', borderBottom: '1px solid #2a3f5a' }}>
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
              color: activeTab === tab.id ? '#fff' : '#8f98a0', 
              paddingBottom: 8, 
              borderBottom: activeTab === tab.id ? '3px solid #66c0f4' : '3px solid transparent', 
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
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: 16 }}>АКТИВНОСТЬ И ОБНОВЛЕНИЯ</h2>
              {changelog.length === 0 ? (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, color: '#8f98a0', fontSize: '13px' }}>
                  Пока нет опубликованных обновлений.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {changelog.map((entry, i) => (
                    <div key={entry.id} style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, borderLeft: `4px solid ${i === 0 ? '#66c0f4' : '#3d4450'}` }}>
                      <div style={{ color: i === 0 ? '#66c0f4' : '#fff', fontWeight: 700, marginBottom: 8, fontSize: '18px' }}>
                        {entry.version}: {entry.title}
                      </div>
                      <div style={{ color: '#8f98a0', fontSize: '12px', marginBottom: 16 }}>Опубликовано {formatPublished(entry.publishedAt)}</div>
                      <p style={{ color: '#dcdedf', fontSize: '14px', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{entry.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: 16 }}>ДОСТИЖЕНИЯ</h2>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, color: '#8f98a0', fontSize: '13px' }}>
                Достижения пока недоступны.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'groups' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>АКТИВНЫЕ ЛОББИ</h2>

            {lobbies.length === 0 ? (
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, color: '#8f98a0', fontSize: '13px' }}>
                Сейчас нет открытых лобби.
              </div>
            ) : (
              lobbies.map((lobby) => (
                <div key={lobby.room} style={{ background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 4, border: '1px solid #3d4450', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '15px' }}>{lobby.room}</div>
                    <div style={{ color: '#8f98a0', fontSize: '12px', marginTop: 4 }}>Хост: {lobby.hostName} • {lobby.memberCount} {lobby.memberCount === 1 ? 'игрок' : 'игроков'}</div>
                  </div>
                  <button onClick={() => handleJoinLobby(lobby.room)} style={{ background: '#5c7e10', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Присоединиться</button>
                </div>
              ))
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <input
                placeholder="Название лобби"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                style={{ background: '#171a21', border: '1px solid #3d4450', borderRadius: 4, padding: '10px 16px', color: '#fff', fontSize: '14px', outline: 'none' }}
              />
              <button
                onClick={() => void handleCreateLobby()}
                disabled={!newRoomName.trim()}
                style={{ background: '#3d4450', color: '#fff', border: 'none', padding: '12px', borderRadius: 4, fontWeight: 600, cursor: newRoomName.trim() ? 'pointer' : 'not-allowed', opacity: newRoomName.trim() ? 1 : 0.5 }}
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
                  <button onClick={() => setViewDiscussion(null)} style={{ background: '#3d4450', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>← Назад</button>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0 }}>{threadDetail?.thread.title ?? 'Загрузка…'}</h2>
                </div>

                {threadDetail && (
                  <>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: 24, borderRadius: 4, border: '1px solid #3d4450' }}>
                      <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid #3d4450', paddingBottom: 16, marginBottom: 16 }}>
                        <div style={{ width: 48, height: 48, background: '#66c0f4', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '20px', color: '#fff' }}>
                          {threadDetail.thread.authorName[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                          <div style={{ color: '#fff', fontWeight: 600, fontSize: '16px' }}>{threadDetail.thread.authorName}</div>
                          <div style={{ color: '#8f98a0', fontSize: '12px' }}>Опубликовано {formatPostTime(threadDetail.posts[0]?.createdAt ?? threadDetail.thread.createdAt)}</div>
                        </div>
                      </div>
                      <div style={{ color: '#dcdedf', fontSize: '15px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {threadDetail.posts[0]?.body}
                      </div>
                    </div>

                    {threadDetail.posts.length > 1 && (
                      <div style={{ paddingLeft: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {threadDetail.posts.slice(1).map((p) => (
                          <div key={p.id} style={{ background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 4, borderLeft: '2px solid #5c7e10' }}>
                            <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: 8 }}>
                              {p.authorName} <span style={{ color: '#8f98a0', fontSize: '12px', fontWeight: 400 }}>• {formatPostTime(p.createdAt)}</span>
                            </div>
                            <div style={{ color: '#dcdedf', fontSize: '14px', whiteSpace: 'pre-wrap' }}>{p.body}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <textarea
                        placeholder="Написать комментарий..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        style={{ width: '100%', height: 100, background: '#171a21', border: '1px solid #3d4450', borderRadius: 4, padding: 12, color: '#fff', resize: 'vertical' }}
                      />
                      <button
                        onClick={() => void handleReply()}
                        disabled={!replyText.trim()}
                        style={{ alignSelf: 'flex-end', background: '#1a9fff', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 4, fontWeight: 600, cursor: replyText.trim() ? 'pointer' : 'not-allowed', opacity: replyText.trim() ? 1 : 0.5 }}
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
                  <button onClick={() => setIsCreatingDiscussion(false)} style={{ background: '#3d4450', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>← Отмена</button>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0 }}>Создать новую тему</h2>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <input
                    placeholder="Заголовок темы (например: Как пройти уровень 4?)"
                    value={newThreadTitle}
                    onChange={(e) => setNewThreadTitle(e.target.value)}
                    style={{ width: '100%', background: '#171a21', border: '1px solid #3d4450', borderRadius: 4, padding: '12px 16px', color: '#fff', fontSize: '16px', outline: 'none' }}
                  />
                  <textarea
                    placeholder="Опишите вашу проблему, идею или вопрос в деталях..."
                    value={newThreadBody}
                    onChange={(e) => setNewThreadBody(e.target.value)}
                    style={{ width: '100%', height: 200, background: '#171a21', border: '1px solid #3d4450', borderRadius: 4, padding: '12px 16px', color: '#fff', fontSize: '15px', resize: 'vertical', outline: 'none' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
                    <button
                      onClick={() => void handleCreateThread()}
                      disabled={!newThreadTitle.trim() || !newThreadBody.trim()}
                      style={{ background: '#5c7e10', color: '#fff', border: 'none', padding: '12px 32px', borderRadius: 4, fontWeight: 600, cursor: newThreadTitle.trim() && newThreadBody.trim() ? 'pointer' : 'not-allowed', fontSize: '16px', opacity: newThreadTitle.trim() && newThreadBody.trim() ? 1 : 0.5 }}
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
                  <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>ОБСУЖДЕНИЯ</h2>
                  <button onClick={() => setIsCreatingDiscussion(true)} style={{ background: '#1a9fff', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Новая тема</button>
                </div>

                {threads.length === 0 ? (
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, color: '#8f98a0', fontSize: '13px' }}>
                    Пока нет обсуждений. Начните первое!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {threads.map((thread, i) => (
                      <div
                        key={thread.id}
                        onClick={() => setViewDiscussion(thread.id)}
                        style={{ background: 'rgba(0,0,0,0.3)', padding: '16px 24px', borderRadius: 4, borderLeft: `4px solid ${i === 0 ? '#1a9fff' : '#3d4450'}`, cursor: 'pointer', transition: 'background 0.2s' }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.3)'}
                      >
                        <div style={{ color: '#fff', fontWeight: 600, fontSize: '16px', marginBottom: 8 }}>{thread.title}</div>
                        <div style={{ display: 'flex', gap: 16, fontSize: '12px', color: '#8f98a0' }}>
                          <span>Автор: {thread.authorName}</span>
                          <span>💬 {thread.replyCount} {thread.replyCount === 1 ? 'ответ' : 'ответов'}</span>
                          <span>Последний ответ: {formatLastPlayed(thread.lastReplyAt).toLowerCase()}</span>
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
