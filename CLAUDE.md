# CLAUDE.md

Production planner for the game **Alchemy Factory**. It's a static Vite + TypeScript site deployed to
GitHub Pages at https://migalicious.github.io/alchemy-factory/. Two players use it (the owner and a
friend); both are in the endgame. Current status, open questions and ideas are in `docs/HANDOFF.md`.

## Commands

```sh
npm install
npm run dev        # dev server
npm test           # vitest: adapter, multipliers, solve, heat, cauldron/vegan, coins, build, plan state
npm run typecheck  # tsc --noEmit (TypeScript 7)
npm run build      # typecheck + vite build to dist/
npm run preview    # serve dist/ on :4173
```

- **Deploy:** every push to `main` runs `.github/workflows/pages.yml` (test → build → deploy). The owner
  has OK'd pushing to `main`. Check the run went green with
  `curl -s https://api.github.com/repos/migalicious/alchemy-factory/actions/runs?per_page=1`.
- **Browser smoke tests:** Playwright isn't a dependency. Install it with `npm install --no-save playwright`
  and launch the cached headless shell at
  `~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`
  via `executablePath`. Keep smoke scripts in the scratchpad, not the repo. The headless shell has no
  emoji font, so emoji show as boxes in screenshots; that's normal.
- **Stopping the preview server:** use `fuser -k 4173/tcp`, not `pkill -f "vite preview"`. The pkill
  pattern also matches, and kills, the shell running it.

## Layout

| Path | What |
|---|---|
| `src/data/alchemy_db.js` | Game data, **vendored verbatim** from starfi5h/AlchemyFactoryCalculator. See `src/data/SOURCE.md`: no upstream license, credited in the footer and README. Don't edit it; put corrections in `overrides.ts`. |
| `src/data/adapter.ts` | Evaluates the DB script in a sandbox and indexes recipes. Also expands the Paradox Crucible "custom input" recipe into one recipe per item, e.g. `Oblivion Essence (Paradox: Lavender)`. Grown and crafted items come before bought raws. |
| `src/data/overrides.ts` | Local assumptions: Steam Boiler slots (9), external machines (Purchasing/Bank Portal). |
| `src/model/` | Types, `Settings` + `defaultSettings()` (a neutral baseline the tests rely on), and upgrade multiplier formulas. |
| `src/solver/solve.ts` | LP solver (yalps). One chosen recipe per item; net output ≥ demand. **Objective:** machines + raw coins/min ÷ `coinsPerBuilding`. Handles byproducts, dual outputs and loops. Also has recipe ordering (`producibleRecipes`: preferred-machine twins first, avoided machines hidden) and `findLoop`. |
| `src/solver/heat.ts` | Heat per line, heating devices, steam, and the boiler bank (only when `steamSupply: 'boilers'`). |
| `src/solver/coins.ts` | Coins/min for bought raws (`rawCoinCost`) and `fmtCoins` (🥉 copper / 🥈 silver / 🥇 gold). |
| `src/solver/build.ts` | "Plan by Buildings": fixed machine counts → reachable rate, busy share per line, choke points, what +1 would give (`buildOutcome`), and the counts needed to reach a chosen rate (`countsToReach`). |
| `src/cauldron/` | `engine.ts`: cauldron output resolution and time/heat. `pool.ts`: grown/bought sources and the ingredient pool. `search.ts`: `findCombos`, `findCombosWith` (by ingredient) and `multiStep`. `cost.ts`: upstream coin-cost model. `vegan.ts`: automatic recipe picking. |
| `src/state/plan.ts` | `PlanState`, `defaultPlan()` (the owner's defaults), URL-hash and localStorage (de)serialisation with migrations. `effectiveChoices` combines vegan picks, user picks and loop resolution. `veganFor` does two-pass scoring with a cache. |
| `src/main.ts` | Wires everything together: `recompute()` (solve → Buildings-mode scaling → heat), then a deferred coin comparison, then render. |
| `src/ui/` | Plain DOM with an `h()` helper. **Top bar:** Plan-by switch, research levels. **Sidebar:** targets, vegan panel, heating/fuel/coins settings, totals. **Tabs:** Table (with the Buildings-mode stepper and banner), Build (zones + starter build), Graph (dagre SVG). **Picker:** recipe filter and "With ingredient" combo search. |

## Game mechanics (all ported from upstream code; don't invent new ones)

- **Upgrades:**
  - Factory speed: `1 + min(l,12)·0.25 + max(0,l−12)·0.05`. It also multiplies heat draw. It doesn't apply to Seed Plots.
  - Alchemy: +6/6/8…/10% yield, only on Extractor, Thermal Extractor, Alembic and Advanced Alembic.
  - Fuel: `1 + 0.1·l`. Fertilizer: `1 + 0.1·l`.
  - Belt: `60 + 15·min(l,12) + 3·max(0,l−12)` items/min. Per-machine output is capped at belt speed, except liquids (Currency gets ×50).
- **Nursery time** = `nutrientCost / fertilizer.maxFertility`. Fertilizer use = `batches · nutrientCost / (nutrientValue · fertMult)`.
- **Heat:** `machine.heatCost` (or `recipe.heatCost` when the machine has −1) × speed, in P/s. Steam = 20 P. A boiler makes 9000 steam/min × speed.
- **Cauldron (3 slots):** T = Σ cauldronCost × {1, 0.65, 0.5} (all different / two the same / all the same). The output is the item with the nearest `cauldronTarget`, weighted by `cauldronMulti`, with ties going to the lower id.
- **Advanced Cauldron (2 slots):**
  - Same + same: the next target above the ingredient's cost.
  - A + B: the target nearest |a−b| that's below the higher of the two costs.
- **Cauldron time and heat** are interpolated from the output's cauldronTarget.
- **Fixed DB cauldron recipes** (e.g. Ruby) override combos that use the same inputs.
- **Paradox Crucible any-item time:** the item's `paradoxTime`, else `1500 / (baseCost·(-maxStack if bulk) · cauldronCost/cauldronTarget)`.
- **Coins:** DB prices are copper. One recipe unit of a raw is one purchase (1 Iron Ore at 1,200 → 100 Iron Ingot), so the cost is rate × buyPrice (Currency uses sellPrice).
  - 1,000 copper = 1 silver, and 100 silver = 1 gold. That's Silver Coin's and Gold Coin's sell prices.

The in-game checks so far: the owners' Clay combos resolve to Clay, and three official cauldron recipes
match the formula. The Advanced Cauldron rules haven't been tested in-game.

## Owner's play style (these drive the defaults; don't undo them without asking)

- **Research:** Logistics 6, Factory 6, Alchemy 2, Fuel 4, Fertilizer 9 (`DEFAULT_UPGRADES`).
- **Targets:** often 0.1/min or less, meaning "the minimum to get started", then they scale the slow lines.
  That's what **Plan by: Buildings** is for.
- **Seed Plots are never used** (manual harvest): `avoidMachines: ['Seed Plot']`. Herbs always come from Nurseries.
- **Steam:** they already have surplus steam from Blast-Potion generators, so the default is `steamSupply: 'existing'`.
- **Machines:** Enhanced Grinder over Grinder (identical-I/O twins only). Build areas are grouped by machine type, and Nurseries stack 3 per floor.
- **"Vegan" means a balance, not purity:**
  - Grown herbs plus cheap bought raws (Logs, Limestone, Iron Ore, Rotten Log, Coal Ore, Rock Salt) are allowed.
  - World Tree Leaf/Core, Pyrite, Quartz and Meteorite are off by default. The World Tree is costly, and they only have one.
  - Bought raws never go straight into cauldrons or the Paradox Crucible; only broken-down items (ingot, sand, plank…) do.
  - Automatic picks aim for **fewest buildings**, scored as rate × (machines + coins/min ÷ `coinsPerBuilding`) + lines, so at low rates fewer steps win.
- **Money:** they make >100 🥇/day on good days, but money is still a constraint. They want to see (and take)
  "halve the coins for a few more machines" trade-offs. That's why `coinsPerBuilding` defaults to 1000 copper,
  and why Totals shows what the weight saves.
- **The recipe picker must keep listing many cauldron options,** with search (recipe filter, "With ingredient").
  Don't force automatic picks to match their in-game habits (e.g. Lavender → Oblivion Essence); search is enough.

## Conventions

- **Commit after each verified increment**, ending with a `Co-Authored-By` trailer, then push (which deploys).
- **Verify before claiming:** run `npm test` and `npm run typecheck`. For UI changes, also do a headless smoke test with screenshots.
- **Plan format:** `sanitize()` must keep old share links working.
  - New fields just need a default in `sanitize()`.
  - When the *meaning* of saved data changes, bump `PLAN_VERSION` (currently 2) and add a migration keyed on `v`.
- **Tests use `defaultSettings()` (neutral: research 0) or `defaultPlan()` (the owner's defaults)** on purpose. Don't make `defaultSettings()` carry the owner's levels.
- **Keep it fast:** vegan scoring is ~0.1–0.3 s per pass.
  - `veganFor` caches on scoring-relevant settings only.
  - The coin comparison runs after render.
  - Aim for under 1 s per edit.
- **Picker dialog:** it's a `<form method="dialog">` that blocks submit. The ✕ is a `type="button"` calling `close()`. Otherwise Enter in a search box closes it.
- Keep numbers in the UI traceable to formulas. When something is an assumption (e.g. boiler slots, the default coin weight), say so in the UI.
