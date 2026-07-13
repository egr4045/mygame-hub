/**
 * Achievement DISPLAY catalog store (game-global, not per-account). A game registers its full set of
 * achievement definitions (name/description/icon/colour); the hub reads them to render a real
 * showcase for every game. In-memory adapter for dev/tests; a Postgres adapter mirrors writes.
 */
import type { AchievementDefinition } from '@mygame/protocol';

/** One catalog entry with its sort order already resolved (the app layer fills it from the index). */
export interface CatalogEntry {
  achievementId: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  sortOrder: number;
}

export interface CatalogStore {
  /** Replace a game's ENTIRE catalog with `entries` (idempotent register). */
  registerCatalog(gameId: string, entries: CatalogEntry[]): void;
  /** Every definition across every game, sorted by gameId then sortOrder. */
  allDefinitions(): AchievementDefinition[];
  /** One game's definitions, sorted by sortOrder. */
  definitionsFor(gameId: string): AchievementDefinition[];
  /** Bulk-load rows verbatim (hydration only). */
  hydrate(defs: AchievementDefinition[]): void;
}

export const createMemoryCatalogStore = (): CatalogStore => {
  const byGame = new Map<string, Map<string, AchievementDefinition>>();

  return {
    registerCatalog(gameId, entries) {
      const m = new Map<string, AchievementDefinition>();
      for (const e of entries) m.set(e.achievementId, { gameId, ...e });
      byGame.set(gameId, m);
    },
    allDefinitions() {
      const out: AchievementDefinition[] = [];
      for (const m of byGame.values()) out.push(...m.values());
      return out.sort((a, b) => a.gameId.localeCompare(b.gameId) || a.sortOrder - b.sortOrder);
    },
    definitionsFor(gameId) {
      return [...(byGame.get(gameId)?.values() ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    },
    hydrate(defs) {
      byGame.clear();
      for (const d of defs) {
        const m = byGame.get(d.gameId) ?? new Map<string, AchievementDefinition>();
        m.set(d.achievementId, d);
        byGame.set(d.gameId, m);
      }
    },
  };
};
