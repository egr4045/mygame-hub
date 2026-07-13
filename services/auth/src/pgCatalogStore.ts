/**
 * Postgres-backed CatalogStore. Reads are synchronous from the in-memory working set; a register
 * replaces the game's rows (delete-then-insert in one queued unit so a game's catalog is swapped
 * atomically in submission order). `init()` hydrates memory on boot.
 */
import { type Pool, WriteQueue } from '@mygame/platform-db';
import type { Logger } from '@mygame/shared-types';
import type { AchievementDefinition } from '@mygame/protocol';
import { createMemoryCatalogStore, type CatalogEntry, type CatalogStore } from './catalogStore.js';

export interface PgCatalogStore extends CatalogStore {
  init(): Promise<void>;
  drain(): Promise<void>;
}

export const createPgCatalogStore = (pool: Pool, logger: Logger): PgCatalogStore => {
  const mem = createMemoryCatalogStore();
  const queue = new WriteQueue(logger);

  return {
    async init() {
      const { rows } = await pool.query(
        `SELECT game_id, achievement_id, name, description, icon, color, sort_order FROM achievement_definitions`,
      );
      mem.hydrate(
        rows.map((r) => ({
          gameId: r.game_id as string,
          achievementId: r.achievement_id as string,
          name: r.name as string,
          description: r.description as string,
          icon: r.icon as string,
          color: r.color as string,
          sortOrder: Number(r.sort_order),
        })),
      );
      logger.info('achievement catalogs hydrated', { count: rows.length });
    },

    registerCatalog(gameId: string, entries: CatalogEntry[]) {
      mem.registerCatalog(gameId, entries);
      // Replace the game's rows as one queued unit: delete the old set, insert the new one.
      queue.push('catalog.replace', async () => {
        await pool.query(`DELETE FROM achievement_definitions WHERE game_id = $1`, [gameId]);
        for (const e of entries) {
          await pool.query(
            `INSERT INTO achievement_definitions (game_id, achievement_id, name, description, icon, color, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [gameId, e.achievementId, e.name, e.description, e.icon, e.color, e.sortOrder],
          );
        }
      });
    },

    allDefinitions: () => mem.allDefinitions(),
    definitionsFor: (gameId: string) => mem.definitionsFor(gameId),
    hydrate: (defs: AchievementDefinition[]) => mem.hydrate(defs),
    drain: () => queue.drain(),
  };
};
