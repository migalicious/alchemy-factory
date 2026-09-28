# CLAUDE.md

Production planner for the game **Alchemy Factory**. It's a static Vite + TypeScript site deployed to
GitHub Pages at https://migalicious.github.io/alchemy-factory/. Two players use it (the owner and a
friend); both are in the endgame. Current status and open questions are in `docs/HANDOFF.md`.

## Commands

```sh
npm install
npm run dev        # dev server
npm test           # vitest (solver, heat, cauldron, vegan, plan state)
npm run typecheck  # tsc --noEmit (TypeScript 7)
npm run build      # typecheck + vite build to dist/
npm run preview    # serve dist/ on :4173
```

- **Deploy:** every push to `main` runs `.github/workflows/pages.yml` (test → build → deploy). The owner
  has OK'd pushing to `main`. Check the run went green with
  `curl -s https://api.github.com/repos/migalicious/alchemy-factory/actions/runs?per_page=1`.
- **Browser smoke tests:** Playwright isn't a dependency. Install it with `npm install --no-save playwright`
  and launch the cached headless shell at `~/.cache/ms-playwright/chromium_headless_shell-1234/…`
  via `executablePath`. Keep smoke scripts in the scratchpad, not the repo.
- **Stopping the preview server:** use `fuser -k 4173/tcp`, not `pkill -f "vite preview"`. The pkill
  pattern also matches, and kills, the shell running it.

## Layout

| Path | What |
|---|---|
| `src/data/alchemy_db.js` | Game data, **vendored verbatim** from starfi5h/AlchemyFactoryCalculator. See `src/data/SOURCE.md`: no upstream license, credited in the footer and README. Don't edit it; put corrections in `overrides.ts`. |
| `src/data/adapter.ts` | Evaluates the DB script in a sandbox and indexes recipes. Also expands the Paradox Crucible "custom input" recipe into one recipe per item. |
| `src/data/overrides.ts` | Local assumptions: Steam Boiler slots (9), external machines (Purchasing/Bank Portal). |
| `src/model/` | Types, settings, and upgrade multiplier formulas. |
| `src/solver/solve.ts` | LP solver (yalps): one chosen recipe per item, min machines, net output ≥ demand. It handles byproducts, dual outputs and loops. Also has recipe ordering (preferred/avoided machines) and `findLoop`. |
| `src/solver/heat.ts` | Heat per line, heating devices, steam, and the boiler bank (only when `steamSupply: 'boilers'`). |
| `src/cauldron/` | `engine.ts`: cauldron output resolution and time/heat. `pool.ts`: sources and the ingredient pool. `search.ts`: combo search and multi-step search. `cost.ts`: upstream coin-cost model. `vegan.ts`: automatic recipe picking. |
| `src/state/plan.ts` | `PlanState`, defaults, URL-hash and localStorage (de)serialisation with migrations, `effectiveChoices` (vegan picks + user picks + loop resolution). |
| `src/ui/` | Plain DOM with an `h()` helper: sidebar, top-bar research, table, Build tab (zones + starter build), graph (dagre SVG), recipe picker. |

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

Only DB recipes where the formula agrees with the game have been verified. The Advanced Cauldron rules
haven't been tested in-game yet.

## Owner's play style (these drive the defaults; don't undo them without asking)

- **Research:** Logistics 6, Factory 6, Alchemy 2, Fuel 4, Fertilizer 9 (`DEFAULT_UPGRADES`).
- **Targets:** often 0.1/min or less, meaning "the minimum to get started", then they scale the slow lines.
- **Seed Plots are never used** (manual harvest): `avoidMachines: ['Seed Plot']`. Herbs always come from Nurseries.
- **Steam:** they already have surplus steam from Blast-Potion generators, so the default is `steamSupply: 'existing'`.
- **Machines:** Enhanced Grinder over Grinder (identical-I/O twins only). Build areas are grouped by machine type, and Nurseries stack 3 per floor.
- **"Vegan" means a balance, not purity:**
  - Grown herbs plus cheap bought raws are allowed.
  - World Tree Leaf/Core, Pyrite, Quartz and Meteorite are off by default.
  - Bought raws never go straight into cauldrons or the Paradox Crucible; only broken-down items (ingot, sand, plank…) do.
  - Automatic picks aim for **fewest buildings**, scored as rate × (machines + coins/min ÷ `coinsPerBuilding`) + lines, so at low rates fewer steps win.
- **Currency:** DB prices are copper. 1,000 copper = 1 silver, 100 silver = 1 gold. The UI shows the largest unit (`fmtCoins`). The owners make >100 gold/day on good days, but money is still a constraint: they want to see (and take) "halve the coins for a few more machines" trade-offs.
- **Coin weight:** `settings.coinsPerBuilding` (default 1000) also goes into the LP objective, so the solver won't burn pricey raws. Example: Salt_Rock (Rock Salt at 9k) used just for its Sand byproduct.
- **The recipe picker must keep listing many cauldron options.** Searching (e.g. Lavender for Oblivion Essence) is enough; don't force automatic picks to match their in-game habits.

## Conventions

- **Commit after each verified increment**, ending with a `Co-Authored-By` trailer, then push (which deploys).
- **Verify before claiming:** run `npm test` and `npm run typecheck`. For UI changes, also do a headless smoke test with screenshots.
- **Plan format changes:** `sanitize()` must keep old share links working. Bump `PLAN_VERSION` and add a migration.
- Keep numbers in the UI traceable to formulas. When something is an assumption (e.g. boiler slots), say so in the UI.
