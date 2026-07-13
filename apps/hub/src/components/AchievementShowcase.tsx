/**
 * A grid of achievement tiles for one game — unlocked ones in colour, locked ones greyed out — with
 * a hover tooltip showing the name + description. Shared by the game page (`GameDetailsView`) and the
 * profile showcase (`ProfileView`). `onPick` (right-click on an unlocked tile) powers "make this my
 * title" in the profile; the game page omits it.
 */
import { useState } from 'react';
import type { AchievementDefinition } from '../platform/achievementsCatalog.js';

const Tile = ({
  def,
  isUnlocked,
  onPick,
}: {
  def: AchievementDefinition;
  isUnlocked: boolean;
  onPick?: ((def: AchievementDefinition, e: React.MouseEvent) => void) | undefined;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div
        onContextMenu={
          onPick && isUnlocked
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onPick(def, e);
              }
            : undefined
        }
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--c-panel-deep)',
          borderRadius: 8,
          border: `2px solid ${isUnlocked ? `${def.color}66` : 'var(--c-panel-border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 26,
          cursor: onPick && isUnlocked ? 'pointer' : 'default',
          opacity: isUnlocked ? 1 : 0.3,
          filter: isUnlocked ? 'none' : 'grayscale(1)',
          transform: hover ? 'scale(1.08)' : 'scale(1)',
          transition: 'transform 0.15s',
          boxShadow: isUnlocked && hover ? `0 0 16px ${def.color}55` : 'none',
        }}
      >
        {def.icon}
      </div>
      {hover && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 8,
            zIndex: 50,
            width: 210,
            maxWidth: '70vw',
            background: 'var(--c-panel-deep)',
            border: `1px solid ${isUnlocked ? `${def.color}88` : 'var(--c-panel-border)'}`,
            borderRadius: 8,
            padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
            textAlign: 'left',
          }}
        >
          <div style={{ color: isUnlocked ? def.color : 'var(--c-text-primary)', fontWeight: 700, fontSize: 13 }}>
            {def.icon} {def.name}
          </div>
          {def.description && (
            <div style={{ color: 'var(--c-text-muted)', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{def.description}</div>
          )}
          {!isUnlocked && (
            <div style={{ color: 'var(--c-text-muted)', fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>🔒 Не получено</div>
          )}
          {onPick && isUnlocked && (
            <div style={{ color: 'var(--c-text-muted)', fontSize: 11, marginTop: 4 }}>ПКМ — сделать титулом</div>
          )}
        </div>
      )}
    </div>
  );
};

export const AchievementShowcase = ({
  defs,
  unlocked,
  onPick,
}: {
  defs: AchievementDefinition[];
  /** Set of unlocked achievementIds for this game. */
  unlocked: Set<string>;
  onPick?: (def: AchievementDefinition, e: React.MouseEvent) => void;
}): JSX.Element => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 12 }}>
    {defs.map((def) => (
      <Tile key={def.achievementId} def={def} isUnlocked={unlocked.has(def.achievementId)} onPick={onPick} />
    ))}
  </div>
);
