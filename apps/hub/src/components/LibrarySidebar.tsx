import { useState, type CSSProperties } from 'react';
import { GAMES, type GameInfo } from '../platform/games.js';
import { usePlatformStore } from '../platform/platformStore.js';
import { useMenuStore } from '@mygame/sdk';

export const LibrarySidebar = ({
  selectedGameId,
  onSelectGame,
  onPlay,
  onOpenDiscussions,
}: {
  selectedGameId: string | null;
  onSelectGame: (id: string) => void;
  onPlay: (game: GameInfo) => void;
  onOpenDiscussions: (game: GameInfo) => void;
}): JSX.Element => {
  const openMenu = useMenuStore((s) => s.openMenu);
  const favoriteGameIds = usePlatformStore((s) => s.favoriteGameIds);
  const toggleFavorite = usePlatformStore((s) => s.toggleFavorite);
  const [search, setSearch] = useState('');

  const filteredGames = GAMES.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));

  const favoriteCategory = filteredGames.filter(g => favoriteGameIds.includes(g.id));
  const inCategory = filteredGames.filter(g => g.status === 'playable');
  const maintenanceCategory = filteredGames.filter(g => g.status === 'maintenance');
  const soonCategory = filteredGames.filter(g => g.status === 'soon');

  return (
    <div className="library-sidebar" style={{ width: 280, background: '#171a21', display: 'flex', flexDirection: 'column', borderRight: '1px solid #000' }}>
      
      {/* Search Bar */}
      <div style={{ padding: '12px 16px', background: '#1a1f29' }}>
        <input 
          placeholder="Поиск" 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            background: '#23262e',
            border: 'none',
            padding: '6px 12px',
            color: '#dcdedf',
            borderRadius: 2,
            fontSize: '13px'
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {favoriteCategory.length > 0 && (
          <>
            <div style={{ fontSize: '11px', color: '#6c7784', textTransform: 'uppercase', padding: '4px 16px', fontWeight: 700, letterSpacing: 1 }}>
              ИЗБРАННОЕ ({favoriteCategory.length})
            </div>
            {favoriteCategory.map(g => (
              <GameListItem
                key={g.id}
                game={g}
                selected={selectedGameId === g.id}
                isFavorite
                onClick={() => onSelectGame(g.id)}
                onPlay={onPlay}
                onOpenDiscussions={onOpenDiscussions}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </>
        )}

        <div style={{ fontSize: '11px', color: '#6c7784', textTransform: 'uppercase', padding: '16px 16px 4px 16px', fontWeight: 700, letterSpacing: 1 }}>
          ИГРЫ ({inCategory.length})
        </div>
        {inCategory.map(g => (
          <GameListItem
            key={g.id}
            game={g}
            selected={selectedGameId === g.id}
            isFavorite={favoriteGameIds.includes(g.id)}
            onClick={() => onSelectGame(g.id)}
            onPlay={onPlay}
            onOpenDiscussions={onOpenDiscussions}
            onToggleFavorite={toggleFavorite}
          />
        ))}

        {maintenanceCategory.length > 0 && (
          <>
            <div style={{ fontSize: '11px', color: '#6c7784', textTransform: 'uppercase', padding: '16px 16px 4px 16px', fontWeight: 700, letterSpacing: 1 }}>
              НА ОБСЛУЖИВАНИИ
            </div>
            {maintenanceCategory.map(g => (
              <GameListItem
                key={g.id}
                game={g}
                selected={selectedGameId === g.id}
                isFavorite={favoriteGameIds.includes(g.id)}
                onClick={() => onSelectGame(g.id)}
                onPlay={onPlay}
                onOpenDiscussions={onOpenDiscussions}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </>
        )}

        {soonCategory.length > 0 && (
          <>
            <div style={{ fontSize: '11px', color: '#6c7784', textTransform: 'uppercase', padding: '16px 16px 4px 16px', fontWeight: 700, letterSpacing: 1 }}>
              СКОРО ВЫЙДУТ
            </div>
            {soonCategory.map(g => (
              <GameListItem
                key={g.id}
                game={g}
                selected={selectedGameId === g.id}
                isFavorite={favoriteGameIds.includes(g.id)}
                onClick={() => onSelectGame(g.id)}
                onPlay={onPlay}
                onOpenDiscussions={onOpenDiscussions}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </>
        )}
      </div>

    </div>
  );
};

const GameListItem = ({
  game,
  selected,
  isFavorite,
  onClick,
  onPlay,
  onOpenDiscussions,
  onToggleFavorite,
}: {
  game: GameInfo;
  selected: boolean;
  isFavorite: boolean;
  onClick: () => void;
  onPlay: (game: GameInfo) => void;
  onOpenDiscussions: (game: GameInfo) => void;
  onToggleFavorite: (gameId: string) => void;
}) => {
  const playable = game.status === 'playable';
  const openMenu = useMenuStore((s) => s.openMenu);
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        background: selected ? '#3d4450' : 'transparent',
        color: selected ? '#fff' : (playable ? '#dcdedf' : '#6c7784'),
      }}
      onMouseOver={(e) => { if(!selected) e.currentTarget.style.background = '#23262e'; }}
      onMouseOut={(e) => { if(!selected) e.currentTarget.style.background = 'transparent'; }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY, [
          ...(playable ? [{ label: '▶️ Играть', action: () => onPlay(game) }] : []),
          {
            label: isFavorite ? '💔 Убрать из избранного' : '🌟 В избранное',
            action: () => onToggleFavorite(game.id),
          },
          { label: '💬 Открыть обсуждения', action: () => onOpenDiscussions(game) },
        ]);
      }}
    >
      <div style={{ width: 32, height: 32, background: game.accent, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
        {game.emoji}
      </div>
      <div style={{ fontSize: '13px', fontWeight: selected ? 600 : 400, flex: 1 }}>
        {game.name}
      </div>
      {isFavorite && <span title="В избранном" style={{ fontSize: 12 }}>⭐</span>}
    </div>
  );
};
