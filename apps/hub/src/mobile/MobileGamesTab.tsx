/**
 * Mobile «Игры» tab — a single-column list of every game (playable first), each a tappable card.
 * Tapping a card opens a stacked full-screen detail (hero → play → recent changelog). The launch
 * flow is the shared `enterAndPlayGame` (identical to the desktop Play button); the changelog reuses
 * the SDK's `getChangelog`. No game logic is reimplemented here.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ChangelogEntry } from '@mygame/protocol';
import { getChangelog } from '@mygame/sdk';
import { GAMES, type GameInfo } from '../platform/games.js';
import { usePlatformStore } from '../platform/platformStore.js';
import { enterAndPlayGame } from '../platform/enterGameFlow.js';

const STATUS_LABEL: Record<GameInfo['status'], string> = {
  playable: 'Доступно',
  soon: 'Скоро',
  maintenance: 'На обслуживании',
};

const statusColor = (status: GameInfo['status']): string =>
  status === 'playable' ? 'var(--c-positive)' : status === 'maintenance' ? 'var(--c-negative)' : 'var(--c-text-muted)';

const formatPublished = (publishedAt: number): string =>
  new Date(publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

const StatusBadge = ({ status }: { status: GameInfo['status'] }): JSX.Element => (
  <span
    style={{
      fontSize: 11,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: statusColor(status),
      border: `1px solid ${statusColor(status)}`,
      borderRadius: 'var(--r-pill)',
      padding: '2px 10px',
      whiteSpace: 'nowrap',
    }}
  >
    {STATUS_LABEL[status]}
  </span>
);

const GameCard = ({ game, onOpen, onPlay }: { game: GameInfo; onOpen: () => void; onPlay: () => void }): JSX.Element => (
  <div
    onClick={onOpen}
    className="hub-card hub-row-hover"
    style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer' }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 52,
          height: 52,
          flex: '0 0 auto',
          background: game.accent,
          borderRadius: 'var(--r-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
        }}
      >
        {game.emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-text-primary)' }}>{game.name}</span>
          <StatusBadge status={game.status} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 4 }}>{game.tagline}</div>
      </div>
    </div>

    {game.status === 'playable' && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        className="hub-btn hub-btn-primary"
        style={{ width: '100%', padding: '12px', fontSize: 16, minHeight: 48 }}
      >
        ▶ Играть
      </button>
    )}
  </div>
);

const GameDetail = ({ game, onBack }: { game: GameInfo; onBack: () => void }): JSX.Element => {
  const selectGame = usePlatformStore((s) => s.selectGame);
  // null = still loading (skeletons), [] = loaded but empty.
  const [changelog, setChangelog] = useState<ChangelogEntry[] | null>(null);

  useEffect(() => {
    setChangelog(null);
    getChangelog(game.id)
      .then(setChangelog)
      .catch(() => setChangelog([]));
  }, [game.id]);

  const playable = game.status === 'playable';

  return (
    <div className="civa-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onBack} className="hub-btn" style={{ alignSelf: 'flex-start', padding: '8px 16px', minHeight: 44 }}>
        ← Назад
      </button>

      {/* Hero */}
      <div
        style={{
          borderRadius: 'var(--r-lg)',
          padding: 24,
          background: `linear-gradient(135deg, ${game.accent}55 0%, var(--c-panel) 100%)`,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 56, lineHeight: 1 }}>{game.emoji}</div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: 'var(--c-text-primary)' }}>{game.name}</h1>
          <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 6 }}>{game.tagline}</div>
          <div style={{ marginTop: 10 }}>
            <StatusBadge status={game.status} />
          </div>
        </div>
      </div>

      {/* Play / unavailable */}
      {playable ? (
        <button
          onClick={() => enterAndPlayGame(game, selectGame)}
          className="hub-btn hub-btn-primary"
          style={{ width: '100%', padding: '16px', fontSize: 18, fontWeight: 700, minHeight: 56 }}
        >
          ▶ Играть
        </button>
      ) : (
        <div className="hub-card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text-muted)' }}>
            {game.status === 'maintenance' ? 'Временно недоступно' : 'Скоро выйдет'}
          </div>
          {game.note && <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 8 }}>{game.note}</div>}
        </div>
      )}

      {/* Changelog */}
      <div>
        <div className="mhub-section-title">Обновления</div>
        {changelog === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="hub-skeleton" style={{ height: 56 }} />
            <div className="hub-skeleton" style={{ height: 56 }} />
          </div>
        ) : changelog.length === 0 ? (
          <div className="hub-card" style={{ padding: 16, color: 'var(--c-text-muted)', fontSize: 13 }}>
            Пока нет опубликованных обновлений.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {changelog.map((entry, i) => (
              <div
                key={entry.id}
                className="hub-card"
                style={{ padding: 16, borderLeft: `4px solid ${i === 0 ? 'var(--c-accent)' : 'var(--c-panel-border)'}` }}
              >
                <div style={{ color: i === 0 ? 'var(--c-accent)' : 'var(--c-text-primary)', fontWeight: 700, fontSize: 15 }}>
                  {entry.version}: {entry.title}
                </div>
                <div style={{ color: 'var(--c-text-muted)', fontSize: 12, margin: '6px 0 10px' }}>
                  {formatPublished(entry.publishedAt)}
                </div>
                <p style={{ color: 'var(--c-text-primary)', fontSize: 14, margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {entry.body}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MobileGamesTab = (): JSX.Element => {
  const selectGame = usePlatformStore((s) => s.selectGame);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Playable games first, then everything else (both keep registry order within their group).
  const ordered = useMemo(
    () => [...GAMES].sort((a, b) => Number(b.status === 'playable') - Number(a.status === 'playable')),
    [],
  );

  const detailGame = detailId ? GAMES.find((g) => g.id === detailId) ?? null : null;
  if (detailGame) return <GameDetail game={detailGame} onBack={() => setDetailId(null)} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text-primary)', margin: '0 0 4px' }}>Игры</h1>
      {ordered.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          onOpen={() => setDetailId(game.id)}
          onPlay={() => enterAndPlayGame(game, selectGame)}
        />
      ))}
    </div>
  );
};
