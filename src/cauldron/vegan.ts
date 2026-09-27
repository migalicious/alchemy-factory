import type { GameData, Recipe } from '../model/types';
import { EXTERNAL_MACHINES } from '../data/overrides';
import { cauldronRecipe, type CauldronType } from './engine';
import { herbPool } from './pool';
import { multiStep } from './search';

export interface VeganOptions {
  /** Count Logs / Rotten Log (trees) as plant sources. */
  includeLogs?: boolean;
  cauldron?: CauldronType;
}

export interface VeganPlan {
  /** item -> recipe id, only where it differs from the item's default recipe. */
  choices: Record<string, string>;
  /** Generated cauldron recipes referenced by `choices`. */
  recipes: Recipe[];
  /** Everything makeable from plant sources. */
  vegan: Set<string>;
  /** Plant raw inputs (seeds, optionally logs). */
  plantRaws: Set<string>;
}

export function plantRaws(db: GameData, includeLogs: boolean): Set<string> {
  const raws = Object.keys(db.items).filter(n => db.items[n].category === 'Raw Materials' && /Seeds?$/.test(n));
  if (includeLogs) raws.push('Logs', 'Rotten Log');
  return new Set(raws.filter(n => db.items[n]));
}

/**
 * 🌿 Vegan mode: pick recipes so that as much as possible is made from plants.
 * Plant sources = seeds (+ logs), and no-input growers (Nursery, World Tree).
 * Producers = normal DB recipes + the herb-pool cauldron combos found by the
 * upstream-style multi-step search. Items are resolved round by round; an item's
 * recipe only uses items resolved in earlier rounds, so the result has no loops.
 * Within a round the item's default recipe wins, then other DB recipes, then cauldron.
 */
export function veganPlan(db: GameData, opts: VeganOptions = {}): VeganPlan {
  const raws = plantRaws(db, opts.includeLogs ?? true);
  const combos = multiStep(db, herbPool(db), opts.cauldron ?? 'Cauldron');
  const cauldron = new Map<string, Recipe>();
  for (const [item, e] of combos) if (e.combo) cauldron.set(item, cauldronRecipe(db, e.combo.type, e.combo.inputs, item));

  const normal = db.recipes.filter(r => !EXTERNAL_MACHINES.has(r.machine) && !r.generated);
  const byOutput = new Map<string, Recipe[]>();
  for (const r of normal) for (const o of Object.keys(r.outputs)) byOutput.set(o, [...(byOutput.get(o) ?? []), r]);

  const vegan = new Set<string>(raws);
  const chosen = new Map<string, Recipe>();
  const ok = (r: Recipe) => Object.keys(r.inputs).every(i => vegan.has(i));
  for (;;) {
    const round = new Map<string, Recipe>();
    for (const item of Object.keys(db.items)) {
      if (vegan.has(item)) continue;
      const candidates = [...(byOutput.get(item) ?? [])];
      const c = cauldron.get(item);
      if (c) candidates.push(c);
      const pick = candidates.find(ok);
      if (pick) round.set(item, pick);
    }
    if (round.size === 0) break;
    for (const [item, r] of round) {
      vegan.add(item);
      chosen.set(item, r);
    }
  }

  const choices: Record<string, string> = {};
  const recipes: Recipe[] = [];
  for (const [item, r] of chosen) {
    if (byOutput.get(item)?.[0]?.id === r.id) continue; // default already
    choices[item] = r.id;
    if (r.generated) recipes.push(r);
  }
  return { choices, recipes, vegan, plantRaws: raws };
}
