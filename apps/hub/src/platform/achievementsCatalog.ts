/**
 * Achievement display catalogs, fetched from the platform (auth's `/auth/achievements/catalog`).
 * Games register their own definitions (name/description/icon/colour) via `mygame.achievements
 * .registerCatalog(...)`; the hub reads them here so the showcase, the game page and the title
 * picker render a real catalog for EVERY game — not a hard-coded CIVA one. One shared fetch, cached
 * at module scope and reused by every surface.
 */
import { useEffect, useState } from 'react';
import { getAchievementCatalog } from '@mygame/sdk';
import type { AchievementDefinition } from '@mygame/protocol';

export type { AchievementDefinition };

let cache: AchievementDefinition[] | null = null;
let inflight: Promise<AchievementDefinition[]> | null = null;
const listeners = new Set<(defs: AchievementDefinition[]) => void>();

const load = (): Promise<AchievementDefinition[]> => {
  if (cache) return Promise.resolve(cache);
  inflight ??= getAchievementCatalog().then((defs) => {
    cache = defs;
    inflight = null;
    for (const l of listeners) l(defs);
    return defs;
  });
  return inflight;
};

export interface Catalogs {
  /** Definitions grouped by gameId, each already sorted by sortOrder. */
  byGame: Map<string, AchievementDefinition[]>;
  /** Look up one definition (undefined if the game never registered it). */
  defOf: (gameId: string, achievementId: string) => AchievementDefinition | undefined;
  loading: boolean;
}

/** All achievement catalogs, grouped by game. Fetched once and shared across every consumer. */
export const useAchievementCatalogs = (): Catalogs => {
  const [defs, setDefs] = useState<AchievementDefinition[] | null>(cache);
  useEffect(() => {
    if (cache) return;
    const l = (d: AchievementDefinition[]): void => setDefs(d);
    listeners.add(l);
    void load();
    return () => {
      listeners.delete(l);
    };
  }, []);

  const byGame = new Map<string, AchievementDefinition[]>();
  for (const d of defs ?? []) {
    const arr = byGame.get(d.gameId);
    if (arr) arr.push(d);
    else byGame.set(d.gameId, [d]);
  }
  for (const arr of byGame.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    byGame,
    defOf: (gameId, achievementId) => (defs ?? []).find((d) => d.gameId === gameId && d.achievementId === achievementId),
    loading: defs === null,
  };
};
