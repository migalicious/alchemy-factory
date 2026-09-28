# Handoff: Alchemy Factory Planner

_Last updated: 2026-09-27. Live at https://migalicious.github.io/alchemy-factory/ (repo `migalicious/alchemy-factory`)._

## What it is

A planner that combines codex's ease of use with starfi5h's data and mechanics:
- Each item appears once.
- Recipes swap per item.
- Steam heating is supported.
- A "🌿 Vegan" automatic picker chooses plant-based and cheap-ore routes, using cauldron combos where they need fewer buildings.

Plans live in the URL hash, so a link can be shared; the last plan is also kept in localStorage.

## Current state (all deployed, 52 tests green)

- **Views:**
  - **Table:** one row per production line, with a recipe picker and per-line heating override.
  - **Build:** one area per machine type, with footprint and stack-per-floor, plus a **Starter build** panel: the rate you get with one machine per line, and which lines to scale first.
  - **Graph:** Zones or Items mode, left-to-right or top-down. Lines are coloured by source; portal inputs, steam and surplus use dashed or dotted styles. Tap a box to focus its connections.
- **Solver:** an LP (yalps) solves one chosen recipe per item; loops are detected and named.
  - A user pick that loops with an automatic pick sends the automatic pick back to its normal recipe.
- **Vegan picker (`src/cauldron/vegan.ts`):**
  - Sources are grown herbs plus Purchasing Portal raws you tick; each shows its buy price.
  - The cauldron pool is those sources + 2 processing steps. Bought raws aren't allowed straight into cauldrons or the Paradox Crucible.
  - Candidates are every DB recipe plus every pool combo plus the multi-step search's best.
  - **Scoring:** fewest buildings = rate × machines-per-(item/min) + lines, including the fertilizer share and heating pads. It runs in two passes, at the target rate and then at each item's actual rate. Fertilizer's cost is iterated until it settles (a Nursery needs fertilizer, which needs herbs). The alternative goal is "Cheapest (coins)", using starfi5h's cost model.
- **Data:** the Paradox Crucible "any item → Oblivion Essence" recipe is expanded per item (e.g. Lavender, 8.3 s).

## Open questions / unverified

- **Advanced Cauldron rules** are ported from upstream but untested in-game. Automatic picks use them, e.g. Clay = Iron Ingot + Iron Ingot. The owner has Advanced Cauldrons but hasn't tried them. If an in-game test disagrees, fix `resolve2` in `src/cauldron/engine.ts`, or add a setting to keep automatic picks off the Advanced Cauldron.
- **Steam Boiler slot count (9)** comes from the owner ("I think"); it only matters when "Plan boilers" is selected.
- **Cauldron and Advanced Cauldron have no `slotsRequired` in the DB**; they're treated as 1 slot, like upstream, and marked "?" in the table.
- **Ruby's fixed DB recipe** doesn't follow the cauldron formula, so combos with its inputs are suppressed. There may be other hidden overrides in the game that we don't know about.

## Ideas not done (ask before building)

- Show the coin cost per minute of bought raws next to the building count, since the owner watches ore spend (Quartz etc.).
- A per-item "lock": keep an automatic pick fixed when settings change.
- Refresh the vendored DB when upstream updates (instructions in `src/data/SOURCE.md`), then rerun the tests.
- Graph readability for very large plans is still limited. The Build tab lists and the Starter panel are the most usable views there.

## Gotchas hit during development

- **Dagre's compound (clustered) layout throws on edges with weight 0.** Steam edges use weight 1, and the graph falls back to an unclustered layout if it throws anyway.
- **LP results carry ~1e-6 noise**, so raw/surplus reporting uses a relative tolerance.
- **"Prefer Enhanced Grinder" must only swap identical-I/O twins.** Otherwise Copper Powder loops through Copper Ingot.
- **Turning Seed Plots off quietly broke vegan scoring**, because nothing could bootstrap the fertilizer cost. The coverage tests in `tests/cauldron.test.ts` guard against that now.
