/**
 * @mygame/shared-types — the domain vocabulary shared across the client and every service.
 *
 * Pure type declarations only (no runtime values except `const` tuples used to derive unions).
 * Balance numbers live in `@mygame/game-config`; wire schemas live in `@mygame/protocol`.
 *
 * Economy model: deliberately flat and small for first-glance clarity. Five tradable/stored
 * resources + Influence (the victory currency). No intermediate goods, no electricity. Fuel is
 * the single military logistics resource (extraction yields it directly — no oil→fuel chain).
 */

export * from './ports.js';

// ---------------------------------------------------------------------------
// Branded identifiers — prevent mixing up the many string ids in the domain.
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type PlayerId = Brand<string, 'PlayerId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type CityId = Brand<string, 'CityId'>;
export type BaseId = Brand<string, 'BaseId'>;
export type BuildingId = Brand<string, 'BuildingId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type NationId = Brand<string, 'NationId'>;

export const asPlayerId = (s: string): PlayerId => s as PlayerId;
export const asSessionId = (s: string): SessionId => s as SessionId;

// ---------------------------------------------------------------------------
// Resources — flat & minimal (5 economic + Influence). Population is a city stat
// (workers + tax base), not a stored/traded resource, but is a ResourceKind for display.
// ---------------------------------------------------------------------------

/** The five economic resources that accumulate on the player's global warehouse. */
export const STORED_RESOURCES = ['food', 'materials', 'fuel', 'money', 'science'] as const;
export type StoredResource = (typeof STORED_RESOURCES)[number];

/** The victory currency. Accrued from conquest/tribute, vote-buying, tech races, diplomacy. */
export const VICTORY_RESOURCES = ['influence'] as const;
export type VictoryResource = (typeof VICTORY_RESOURCES)[number];

/** Physical goods that can be moved/traded on the market (money & science are not). */
export const MARKET_RESOURCES = ['food', 'materials', 'fuel'] as const;
export type MarketResource = (typeof MARKET_RESOURCES)[number];

export const ALL_RESOURCES = [...STORED_RESOURCES, ...VICTORY_RESOURCES, 'population'] as const;
export type ResourceKind = (typeof ALL_RESOURCES)[number];

/** A bag of resource amounts. Partial: absent keys mean zero. */
export type ResourceBag = Partial<Record<ResourceKind, number>>;

// ---------------------------------------------------------------------------
// Biomes (section 4). Hexes are tied to real geography and bias resource output,
// creating the deficits that force trade & diplomacy.
// ---------------------------------------------------------------------------

export const BIOMES = ['desert', 'taiga', 'mountains', 'plains', 'ocean', 'tundra'] as const;
export type BiomeKind = (typeof BIOMES)[number];

// ---------------------------------------------------------------------------
// Buildings — flat production (no intermediate goods). Each produces a final resource
// directly. Mini-city structures (military_base/warehouse/airfield/port) are founded on tiles.
// ---------------------------------------------------------------------------

export const BUILDINGS = [
  'farm', // -> food
  'mine', // -> materials (merged wood + ore)
  'fuel_rig', // -> fuel (extraction yields fuel directly; no refinery chain)
  'market', // -> money (local taxes/commerce)
  'university', // -> science
  'house', // -> population capacity
  'air_defense', // intercepts aircraft & missiles (building, replaces AA/ABM units)
  'military_base', // garrison hub (mini-city, founded on a tile)
  'warehouse', // storage capacity (mini-city)
  'airfield', // base/refuel aircraft, extend air range (mini-city)
  'port', // sea trade & cheaper exchange delivery (coastal mini-city)
  'exchange', // unique global market (one owner sets commission)
  'diplomatic_mission', // boosts influence / vote-buying efficiency
] as const;
export type BuildingKind = (typeof BUILDINGS)[number];

/** Buildings founded directly on an empty tile (vs. slotted inside a city). */
export const TILE_STRUCTURES = ['military_base', 'warehouse', 'airfield', 'port'] as const;
export type TileStructure = (typeof TILE_STRUCTURES)[number];

// ---------------------------------------------------------------------------
// Military units (section 6): four roles. No on-map micro — units have a strike range
// in hexes. Air defense is a building, not a unit. Attacks at range burn Fuel.
// ---------------------------------------------------------------------------

export const UNITS = ['infantry', 'tank', 'aircraft', 'missile'] as const;
export type UnitKind = (typeof UNITS)[number];

// ---------------------------------------------------------------------------
// Tech tree (section 5): 3 branches × 3 tiers. First to reach a tier wins an
// Influence bounty (the "tech race").
// ---------------------------------------------------------------------------

export const TECH_BRANCHES = ['economy', 'logistics', 'military'] as const;
export type TechBranch = (typeof TECH_BRANCHES)[number];

export type TechTier = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Diplomacy — relations include vassal/overlord (the secret-bloc mechanic).
// ---------------------------------------------------------------------------

export const DIPLOMATIC_RELATIONS = [
  'ally',
  'neutral',
  'tension',
  'hostile',
  'vassal', // this player serves an overlord
  'overlord', // this player commands a vassal
] as const;
export type DiplomaticRelation = (typeof DIPLOMATIC_RELATIONS)[number];

// ---------------------------------------------------------------------------
// Game phases / lifecycle (section 3).
// ---------------------------------------------------------------------------

export const GAME_PHASES = ['lobby', 'year', 'assembly', 'finale'] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

/** A match runs for 5 in-game "years"; the player with the most Influence is elected UN Leader. */
export const TOTAL_YEARS = 5;
