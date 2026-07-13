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

const LS_KEY = 'mygame:achievementCatalogs';

const readLsCache = (): AchievementDefinition[] | null => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as AchievementDefinition[]) : null;
  } catch {
    return null;
  }
};

// Seed from localStorage so the showcase paints instantly on a reload (stale-while-revalidate): the
// cached catalog renders immediately, then the network copy replaces it. Catalogs are game-global and
// rarely change, so a briefly-stale copy is harmless.
let cache: AchievementDefinition[] | null = readLsCache();
let revalidated = false;
let inflight: Promise<AchievementDefinition[]> | null = null;
const listeners = new Set<(defs: AchievementDefinition[]) => void>();

const revalidate = (): Promise<AchievementDefinition[]> => {
  inflight ??= getAchievementCatalog()
    .then((defs) => {
      cache = defs;
      revalidated = true;
      inflight = null;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(defs));
      } catch {
        /* storage blocked — cache just won't warm */
      }
      for (const l of listeners) l(defs);
      return defs;
    })
    .catch(() => {
      inflight = null;
      return cache ?? [];
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

/** All achievement catalogs, grouped by game. Renders instantly from the localStorage cache and
 *  revalidates from the network once per session; shared across every consumer. */
export const useAchievementCatalogs = (): Catalogs => {
  const [defs, setDefs] = useState<AchievementDefinition[] | null>(cache);
  useEffect(() => {
    const l = (d: AchievementDefinition[]): void => setDefs(d);
    listeners.add(l);
    if (!revalidated) void revalidate(); // stale-while-revalidate: refresh once even if cache seeded us
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
