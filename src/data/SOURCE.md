# Game data source

`alchemy_db.js` is copied verbatim from
[starfi5h/AlchemyFactoryCalculator](https://github.com/starfi5h/AlchemyFactoryCalculator)
at commit `af07fec67914f215df9f1ccac2175e1310a72573` (branch `develop`, 2026-09-25).

- DB version 56, dated 2026.09.14, game version 1.0.4952.
- The upstream repository has **no license file**. All credit for the data goes to
  starfi5h and contributors. It's vendored here for a small personal/friends tool;
  if the author objects, remove it and load it at runtime instead.
- The cauldron and game-mechanic formulas in `src/cauldron/` and `src/model/` are
  re-implemented from reading upstream `js/alchemy_cauldron.js` and
  `js/alchemy_calc_engine.js`.

To update: download the new `js/alchemy_db.js`, replace this file's copy, update the
SHA above, and run `npm test`.
