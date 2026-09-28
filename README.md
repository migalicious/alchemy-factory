# Alchemy Factory Planner

A production planner for [Alchemy Factory](https://store.steampowered.com/app/3669570/) that combines the ease of
[alchemy-factory-codex.com's planner](https://alchemy-factory-codex.com/production-planner/) with the depth of
[starfi5h's calculator](https://starfi5h.github.io/AlchemyFactoryCalculator/).

- **Each item appears once.** Shared intermediates are merged instead of being redrawn for every consumer. You get three views:
  - **Table:** every production line.
  - **Build:** one area per machine type, plus a "starter build" showing the rate with one machine per line.
  - **Graph:** zones or items, left→right or top↓down.
- **Swap any recipe in one click.** That includes cauldron combos (any 3 ingredients in a Cauldron, or 2 in an Advanced Cauldron), Paradox Crucible any-item recipes, and "treat as raw input" to cut off a subtree.
- **Steam Heating Pads.**
  - By default, steam comes from your existing supply and the planner just reports total demand.
  - Switch to "Plan boilers" to get a boiler bank with its furnaces and fuel.
  - Any line can go back to a furnace with item fuel.
- **🌿 Vegan mode.** Recipes are auto-picked from the sources you allow.
  - Sources are grown herbs plus the cheap raws you tick to buy. Their products up to 2 processing steps away can go into cauldrons.
  - Picks aim for the fewest buildings at your target rate.
- **Share links.** The whole plan lives in the URL.

Contributor and agent notes are in [CLAUDE.md](CLAUDE.md); the current state and open questions are in [docs/HANDOFF.md](docs/HANDOFF.md).

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests (solver, heat, cauldron, vegan, sharing)
npm run build    # static site in dist/
```

It deploys to GitHub Pages from `main` via `.github/workflows/pages.yml`. In the repo, set Settings → Pages → Source to **GitHub Actions**.

## Credits

Game data (`src/data/alchemy_db.js`) is copied from
[starfi5h/AlchemyFactoryCalculator](https://github.com/starfi5h/AlchemyFactoryCalculator). The upstream repo has no
license file, so all credit for the data and for the mechanics this tool re-implements goes to starfi5h and its
contributors. See `src/data/SOURCE.md` for the exact commit and how to update. Not affiliated with the game's developers.

## Known assumptions

- A Steam Boiler takes 9 furnace slots, based on player reports (the DB doesn't say). That's 1 per Stone Furnace and
  4 per Blast Furnace, in whole boilers. Change it in `src/data/overrides.ts`.
- Machines with no `slotsRequired` in the DB (Cauldron, Advanced Cauldron) are treated as 1 slot, like upstream. They're marked with `?`.
