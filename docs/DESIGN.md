# CIVA — Game Design (simplified model + victory)

> **Scope:** this document describes the **CIVA 4X game** — a *separate product* that the platform in
> this repo launches as an on-demand stack. It is **not** the platform's design. The game's code and
> `packages/game-config` are not in this repository (the game ships from its own `deploy/civa-game`
> compose). The CIVA domain types referenced below also appear in `@mygame/shared-types`, but the
> platform itself does not use them. For the platform, see `STATUS.md` / `ARCHITECTURE.md` / `PLAN.md`.

This is the agreed design after the criteria review. It is the source of truth for balance intent;
numbers live in `packages/game-config` (in the game's repo).

## Design criteria (the bar every mechanic must clear)

1. **Pushes social interaction** — biome deficits make trade necessary; conquest, vassalage, the
   exchange and vote-buying all run through other players.
2. **Legible at first glance** — flat economy, few resources, no hidden chains.
3. **Obvious consequences** — every build/recruit shows its exact per-tick effect (ProductionPreview).
4. **Multiple viable win strategies** — a single Influence score reachable four different ways.

## Economy (flat, no chains)

Five economic resources + one victory currency. **Population** is a city stat (workers + taxes),
not a stored/traded resource.

| Resource | Source | Use |
|---|---|---|
| 🌾 Food | Farm | Feeds population & armies |
| 🧱 Materials | Mine (merged wood+ore) | Build everything; recruit units |
| ⛽ Fuel | Fuel Rig (extracted directly — no oil→fuel chain) | The single military logistics resource (attacks at range burn fuel) |
| 💰 Money | Market (taxes) | Recruit, buy on the exchange, **buy votes** |
| 🔬 Science | University | Tech tree (3 branches × 3 tiers) |
| ⭐ Influence | the four sources below | **Victory currency** |

Buildings produce a **final resource directly** — no intermediate goods, no electricity. Mini-city
structures (Military Base, Warehouse, Airfield, Port) are founded on tiles. **Air Defense** is a
building (not a unit) that intercepts aircraft & missiles.

Units are **four roles**: Infantry (R1, loots 15%), Tank (R2, anti-armor), Aircraft (R5, ignores
armor), Missile (R10, one-shot). Attacking at range costs **fuel ∝ distance**. Defenders keep +30%
armor; you need forward bases to project power.

## Victory: a single Influence score (5 years → elected UN Leader)

Most Influence after 5 years wins. **Vassals' influence feeds their overlord's bloc**; blocs are
secret until the final screen reveals them. Four sources (`influenceConfig`):

| Source | Strategy | How |
|---|---|---|
| ⚔️ Conquest / vassalage | **Military hegemon** | Beat a player → they pay **tribute** or become a **secret vassal** (their influence flows to you) |
| 💰 Bought votes | **Trade tycoon** | Spend large sums of money to buy votes (Influence not earned passively) |
| 🔬 Tech races | **Technologist** | First to each tech tier wins an Influence bounty |
| 🕊️ Diplomacy | **Diplomat** | Pacts, reputation, brokering; peacefully recruit vassals |

Balance is rock-paper-scissors: conquest is countered by alliances; the trader funds everyone but is
militarily soft; the technologist is a slow-starting force multiplier; the diplomat depends on money
and partners. The `influenceConfig` weights are the primary tuning lever.

On-map visibility (the UN screen is untouched for now): the **StandingsPanel** shows the bloc
leaderboard, secret vassals, and the breakdown of your four Influence sources + per-tick gain.

## Where it lives

- Types: `packages/shared-types` (resources, units, buildings, `DiplomaticRelation` incl. vassal/overlord).
- Numbers: `packages/game-config` (`buildings`, `units`, `combatConfig`, `influenceConfig`, `victoryConfig`).
- UI (mocks): `apps/hub/src/mock/*`, `components/ProductionPreview.tsx`, `panels/StandingsPanel.tsx`,
  `dialogs/AttackDialog.tsx` (tribute/vassal), `panels/DiplomacyPanel.tsx` (buy votes / vassalage),
  `screens/FinaleScreen.tsx` (bloc reveal).
