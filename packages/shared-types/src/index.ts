/**
 * @mygame/shared-types — infrastructure ports (`Clock`, `Logger`, `EventBus`) shared across every
 * platform service and the SDK. Wire schemas live in `@mygame/protocol`.
 *
 * Used to also carry CIVA's own game-domain vocabulary (resources/biomes/buildings/units/tech/
 * diplomacy/game-phases) from when this repo was still a fork of CIVA's own — removed 2026-07-16
 * (verified zero platform usages first; CIVA's next implementation starts over, so nothing to move).
 */

export * from './ports.js';
