# Handoff: Alchemy Factory Planner

_Last updated: 2026-09-27. Live at https://migalicious.github.io/alchemy-factory/ (repo `migalicious/alchemy-factory`, branch `main`). All deployed; 64 tests in 8 files are green._

## What it is

A planner that combines codex's ease of use with starfi5h's data and mechanics:
- Each item appears once.
- Recipes swap per item, including cauldron combos.
- Steam heating is supported.
- A "🌿 Vegan" automatic picker chooses plant-based and cheap-ore routes that need the fewest buildings and coins.

Plans live in the URL hash, so a link can be shared; the last plan is also kept in localStorage.

## Current state

### Layout
- **Top bar:** **Plan by: Rate | Buildings**, the research levels, the 🌿 Vegan toggle, and "Copy share link".
- **Sidebar:**
  - targets;
  - the vegan panel (when on);
  - Heating & fuel: default heating, steam source, furnace, fuel, fertilizer, **1 building ≈ 🥉 copper/min**, prefer Enhanced Grinder, never use Seed Plots;
  - Totals: coins/min, fuel, steam, heat, fertilizer, raw inputs (with coins/min, most expensive first), surplus, buildings.
- **Tabs:**
  - **Table:** one row per production line, with the recipe picker and a per-line heating override.
  - **Build:** one area per machine type (footprint, stack-per-floor, gets/sends), plus a **Starter build** panel in Rate mode.
  - **Graph:** Zones or Items mode, left→right or top↓down. Belts are coloured by source; Purchasing Portal inputs are orange dashed, steam blue dotted, surplus grey dashed. Tap a box to focus its connections.

### Plan by Buildings
- Every line starts with 1 machine.
- `src/solver/build.ts` computes the reachable rate: aim × min(count ÷ machines-needed). This works because lines scale linearly with fixed recipes.
- **The table shows:**
  - − / + counts per line, and busy bars (red = choke point, orange ≥ 80%);
  - a banner: "N machines make X/min (Y% of your aim)", the choke point, and "+1 there → new rate" with an **Add it** button;
  - "Reset to 1 each" and "Busiest lines first";
  - **"Reach [X]/min"**, which defaults to the aim. It lists which lines need more machines and how many: each line needs ⌈machines-at-aim × X ÷ aim⌉ (`countsToReach`). **Apply** sets those counts. Example: vegan Moonlit Soap from 1 per line → reach 0.1/min = add 76 machines → 126 machines, 0.105/min.
- The plan is solved again at the reachable rate, so Totals, heat, coins and the Build tab match. Each line's `machinesCeil` is overwritten with your count.
- The target rate becomes the **aim**: it steers vegan recipe picks and the ratios between targets.
- Counts are stored per recipe id in `plan.counts`. If a line's recipe changes, that line goes back to 1.
- The coin comparison is skipped in this mode.

### Solver
- LP via yalps. One chosen recipe per item.
- **Objective:** machines + raw coins/min ÷ `coinsPerBuilding` (default 1,000 🥉). The coin term stops it running Salt_Rock (Rock Salt at 9k) just for its Sand.
- Loops are detected and named.
- If a user pick closes a loop with an automatic pick, the automatic pick goes back to its normal recipe, and a note tells you.

### Vegan picker (`src/cauldron/vegan.ts`)
- **Sources:** herbs grown in Nurseries, plus the Purchasing Portal raws you tick, each with its buy price.
  - Off by default: World Tree Leaf/Core, Pyrite, Quartz, Meteorite.
- **Cauldron pool:** sources + 2 processing steps, e.g. ore → ingot → sand. Bought raws can't go straight into cauldrons or the Paradox Crucible (there's a toggle).
- **Candidates:** every DB recipe, every combo from the pool, and the multi-step search's best.
- **Scoring (fewest buildings):** rate × (machines + coins ÷ coinsPerBuilding) + lines. Machines include the fertilizer share and heating pads.
  - Two passes: at the target rate, then at each item's actual rate.
  - Fertilizer's machine and coin cost is iterated until it settles.
  - Alternative goal: "Cheapest (coins)" (upstream cost model).
- **Totals** show what the coin weight buys, e.g. "saves 23.2 🥈/min for +9 buildings". This comes from a second solve with coins ignored, run just after render.

### Picker
- DB recipes, plus a filter box when there are more than 10 (Oblivion Essence has 91 Paradox options).
- "Treat as raw input", and reset.
- Cauldron combos (🌿 your sources / all items), plus **"With ingredient"** search, which includes doubles like Redcurrant ×2 + Sage.

### Reference numbers (owner defaults, vegan on)

| Target | Rate mode | Buildings mode, 1 per line |
|---|---|---|
| Moonlit Soap | 0.1/min: ~126 machines, ~21.5 🥈/min | 50 machines → 0.009/min; first choke point is the Oblivion Essence Paradox Crucible |
| Star Dust | 0.5/min: ~108 machines, ~19.6 🥈/min | — |

## Open questions / unverified

- **Advanced Cauldron rules** are ported from upstream but untested in-game. Automatic picks use them, e.g. Clay = Iron Ingot + Iron Ingot. The owner has Advanced Cauldrons but hasn't tried them. If an in-game test disagrees, fix `resolve2` in `src/cauldron/engine.ts`, or add a setting to keep automatic picks off the Advanced Cauldron.
- **The default coin weight (1,000 🥉 per building)** is our pick. It gives roughly half the coins for about 5–10% more buildings. The owner confirmed that trade-off is what they want, but may tune the number. The input is in copper; offer silver if it feels awkward.
- **Steam Boiler slot count (9)** comes from the owner ("I think"); it only matters when "Plan boilers" is selected.
- **Cauldron and Advanced Cauldron have no `slotsRequired` in the DB**; they're treated as 1 slot, like upstream, and marked "?" in the table.
- **Ruby's fixed DB recipe** doesn't follow the cauldron formula, so combos with its inputs are suppressed. There may be other hidden overrides in the game that we don't know about.
- **In Buildings mode, the aim affects recipe choice.** Vegan picks are scored at the aim rate, so a very different real rate could favour other recipes. We haven't seen this cause a problem.

## Ideas not done (ask before building)

- A per-item "lock": keep an automatic pick fixed when settings change.
- **Buildings mode:** flag idle machines (count well above what the current rate needs).
- Coin-weight input in silver instead of copper.
- Refresh the vendored DB when upstream updates (instructions in `src/data/SOURCE.md`), then rerun the tests.
- Graph readability for very large plans is still limited. The Build tab, the Buildings-mode table and the Starter panel are the most usable views there.

## Gotchas hit during development

- **Dagre's compound (clustered) layout throws on edges with weight 0.** Steam edges use weight 1, and the graph falls back to an unclustered layout if it throws anyway.
- **LP results carry ~1e-6 noise**, so raw/surplus reporting uses a relative tolerance.
- **"Prefer Enhanced Grinder" must only swap identical-I/O twins.** Otherwise Copper Powder loops through Copper Ingot.
- **Turning Seed Plots off quietly broke vegan scoring**, because nothing could bootstrap the fertilizer cost. The coverage tests in `tests/cauldron.test.ts` guard against that now.
- **A min-machines LP treats buying as free**, so it overused Salt_Rock for its Sand byproduct. Fixed by the coin term.
- **Keeping only the 12 coin-cheapest combos per item hid good short recipes** (Redcurrant ×2 + Sage was ranked 253rd). Vegan now considers every pool combo.
- **Pressing Enter in a `<form method="dialog">` search box** clicks the first submit button (the ✕) and closes the dialog.
- **Building the combo list with `[...list, x]` inside the triple loop** was quadratic: 8 s for all items. It uses `push` now.
