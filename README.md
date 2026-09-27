# Alchemy Factory Planner

A production planner for [Alchemy Factory](https://store.steampowered.com/app/3669570/) that combines the ease of
[alchemy-factory-codex.com's planner](https://alchemy-factory-codex.com/production-planner/) with the depth of
[starfi5h's calculator](https://starfi5h.github.io/AlchemyFactoryCalculator/).

- **Each item appears once.** Shared intermediates are merged instead of being redrawn for every consumer, so endgame charts stay readable. You get a table and a graph view.
- **Swap any recipe in one click.** That includes cauldron combos (any 3 ingredients in a Cauldron, or 2 in an Advanced Cauldron) and "treat as raw input" to cut off a subtree.
- **Steam Heating Pads.** Heated machines can sit on pads. Every steam line rolls up into one **boiler bank** that shows boilers, the furnaces under them, and fuel. You can switch any line back to a furnace with item fuel.
- **🌿 Vegan mode.** Recipes are auto-picked so everything comes from plants (seeds and herbs, optionally logs). It uses normal recipes plus herb-pool cauldron chains, like starfi5h's 🌿 cauldron preset. Non-plant raw inputs are flagged.
- **Share links.** The whole plan lives in the URL.

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

- A Steam Boiler is assumed to take 9 furnace slots (a full Stone Furnace). The DB doesn't say. Change it in
  `src/data/overrides.ts`.
- Machines with no `slotsRequired` in the DB (Cauldron, Advanced Cauldron) are treated as 1 slot, like upstream. They're marked with `?`.
