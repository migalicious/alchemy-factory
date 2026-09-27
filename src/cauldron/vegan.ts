import type { GameData, Recipe } from '../model/types';
import { cauldronRecipe, type CauldronType } from './engine';
import { plantPool } from './pool';
import { multiStep } from './search';
import { producibleRecipes, recipeLookup } from '../solver/solve';

export interface VeganOptions {
  /** Plant sources switched off plus any items to avoid (never used as vegan ingredients). */
  exclude?: Iterable<string>;
  /** Processing steps from plant sources that count as cauldron ingredients. */
  depth?: number;
  cauldron?: CauldronType;
  /** Preferred machines (so "default" matches the solver's default). */
  prefer?: readonly string[];
}

export interface VeganPlan {
  /** item -> recipe id, only where it differs from the item's default recipe. */
  choices: Record<string, string>;
  /** Generated cauldron recipes referenced by `choices`. */
  recipes: Recipe[];
  /** Everything makeable from the enabled plant sources. */
  vegan: Set<string>;
  /** Plant raw inputs (seeds, and logs if enabled). */
  plantRaws: Set<string>;
  exclude: Set<string>;
}

export function plantRaws(db: GameData, exclude: Set<string>): Set<string> {
  const raws = Object.keys(db.items).filter(n => db.items[n].category === 'Raw Materials' && /Seeds?$/.test(n));
  raws.push('Logs', 'Rotten Log');
  return new Set(raws.filter(n => db.items[n] && !exclude.has(n)));
}

/**
 * 🌿 Vegan mode: pick recipes so that as much as possible is made from plants.
 * Sources = seeds (grown in Nursery/Seed Plot), enabled herbs, and logs if enabled.
 * Producers = DB recipes + cauldron combos found by the upstream-style multi-step
 * search over the plant pool. Items are resolved round by round; an item's recipe only
 * uses items resolved in earlier rounds, so there are no loops. Within a round the
 * item's default recipe wins, then other DB recipes, then the cauldron combo.
 */
export function veganPlan(db: GameData, opts: VeganOptions = {}): VeganPlan {
  const exclude = new Set(opts.exclude ?? []);
  const raws = plantRaws(db, exclude);
  const combos = multiStep(db, plantPool(db, { exclude, depth: opts.depth ?? 1 }), opts.cauldron ?? 'Cauldron');
  const lookup = recipeLookup(db, [], opts.prefer ?? []);
  const cauldron = new Map<string, Recipe>();
  for (const [item, e] of combos) {
    if (!e.combo || exclude.has(item) || e.combo.inputs.some(i => exclude.has(i))) continue;
    cauldron.set(item, cauldronRecipe(db, e.combo.type, e.combo.inputs, item));
  }

  const vegan = new Set<string>(raws);
  const chosen = new Map<string, Recipe>();
  const ok = (r: Recipe) => Object.keys(r.inputs).every(i => vegan.has(i));
  for (;;) {
    const round = new Map<string, Recipe>();
    for (const item of Object.keys(db.items)) {
      if (vegan.has(item) || exclude.has(item)) continue;
      const candidates = producibleRecipes(lookup, item).filter(r => !r.generated);
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
    if (producibleRecipes(lookup, item)[0]?.id === r.id) continue; // default already
    choices[item] = r.id;
    if (r.generated) recipes.push(r);
  }
  return { choices, recipes, vegan, plantRaws: raws, exclude };
}
