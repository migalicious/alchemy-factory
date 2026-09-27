import type { GameData, Recipe } from '../model/types';
import { YIELD_MULTIPLIER_MACHINES } from '../model/multipliers';
import { cauldronRecipe, type CauldronType } from './engine';
import { plantPool } from './pool';
import { multiStep } from './search';
import { buildItemBaseCost } from './cost';
import { batchesPerMachine, producibleRecipes, recipeLookup } from '../solver/solve';
import { defaultSettings, mults, type Settings } from '../model/settings';

export interface VeganOptions {
  /** Plant sources switched off plus any items to avoid (never used as vegan ingredients). */
  exclude?: Iterable<string>;
  /** Processing steps from plant sources that count as cauldron ingredients. */
  depth?: number;
  cauldron?: CauldronType;
  /** Preferred / avoided machines (so "default" matches the solver's default). */
  prefer?: readonly string[];
  avoid?: readonly string[];
  /** What "best" means when several plant-based recipes exist. */
  goal?: VeganGoal;
  /** Plan settings (speeds, fertilizer) used to count buildings. */
  settings?: Settings;
}

/** buildings: fewest machines incl. fertilizer upkeep; coins: cheapest by upstream cost model. */
export type VeganGoal = 'buildings' | 'coins';

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
  /** Score per item along the chosen recipes: machines per item/min, or copper per item. */
  cost: Map<string, number>;
}

const yieldMult = (r: Recipe, alchemy: number) => (YIELD_MULTIPLIER_MACHINES.includes(r.machine) ? alchemy : 1);
const HEAT_PER_COPPER = 20; // upstream cauldron cost settings defaults
const NUTR_PER_COPPER = 12;

/**
 * Safety net: with positive costs the cheapest-recipe graph shouldn't loop, but if a
 * choice ever feeds back into itself, drop it so the item falls back to its default.
 */
function breakCycles(chosen: Map<string, Recipe>): void {
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const visit = (item: string): void => {
    if (state.get(item) === 2) return;
    state.set(item, 1);
    const r = chosen.get(item);
    if (r) {
      for (const i of Object.keys(r.inputs)) {
        if (state.get(i) === 1) {
          chosen.delete(item);
          break;
        }
        visit(i);
      }
    }
    state.set(item, 2);
  };
  for (const item of [...chosen.keys()]) visit(item);
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
 * search over the plant pool. Each item gets its cheapest plant-based recipe by
 * estimated copper cost (ties go to the default recipe).
 */
export function veganPlan(db: GameData, opts: VeganOptions = {}): VeganPlan {
  const exclude = new Set(opts.exclude ?? []);
  const raws = plantRaws(db, exclude);
  const combos = multiStep(db, plantPool(db, { exclude, depth: opts.depth ?? 1 }), opts.cauldron ?? 'Cauldron');
  const lookup = recipeLookup(db, [], opts.prefer ?? [], opts.avoid ?? opts.settings?.avoidMachines ?? []);
  const cauldron = new Map<string, Recipe>();
  for (const [item, e] of combos) {
    if (!e.combo || exclude.has(item) || e.combo.inputs.some(i => exclude.has(i))) continue;
    cauldron.set(item, cauldronRecipe(db, e.combo.type, e.combo.inputs, item));
  }

  // Score every plant-based recipe and relax until stable, so each item uses its best one.
  //  - buildings: machines per 1 item/min, including inputs' machines and the machines
  //    that make the fertilizer a grower eats (heat ignored: steam is usually plentiful).
  //  - coins: upstream cost model; raws at buy price, nutrients / 12, heat / 20.
  // Either way pricey routes like World Tree Core lose unless nothing else works.
  const goal = opts.goal ?? 'buildings';
  const settings = opts.settings ?? defaultSettings();
  const m = mults(settings);
  const fert = db.items[settings.fertilizer];
  const base = buildItemBaseCost(db);
  const cost = new Map<string, number>();
  for (const r of raws) cost.set(r, goal === 'coins' ? base.get(r) ?? 0 : 0); // buying from a portal needs no production machines
  const chosen = new Map<string, Recipe>();
  const recipeCost = (r: Recipe, item: string): number | null => {
    let sum = 0;
    for (const [i, q] of Object.entries(r.inputs)) {
      const c = cost.get(i);
      if (c === undefined) return null;
      sum += c * q;
    }
    const mach = db.machines[r.machine];
    if (goal === 'coins') {
      if (mach?.heatCost) sum += ((mach.heatCost > 0 ? mach.heatCost : r.heatCost ?? 0) * (r.baseTime || 1)) / HEAT_PER_COPPER; // P/s x s
      if (r.nutrientCost) sum += r.nutrientCost / NUTR_PER_COPPER;
    } else {
      sum += 1 / batchesPerMachine(db, r, settings, m); // machines to run 1 batch/min
      if (r.nutrientCost && fert?.nutrientValue) {
        // Fertilizer items per batch x machines per fertilizer; unknown yet => not usable yet.
        const fertEffort = cost.get(settings.fertilizer);
        if (fertEffort === undefined) return null;
        sum += (r.nutrientCost / (fert.nutrientValue * m.fert)) * fertEffort;
      }
    }
    return sum / (r.outputs[item] * (goal === 'buildings' ? yieldMult(r, m.alchemy) : 1));
  };
  const candidatesFor = new Map<string, Recipe[]>();
  for (const item of Object.keys(db.items)) {
    if (exclude.has(item) || raws.has(item)) continue;
    const list = producibleRecipes(lookup, item).filter(r => !r.generated);
    const c = cauldron.get(item);
    if (c) list.push(c);
    if (list.length) candidatesFor.set(item, list);
  }
  for (let pass = 0; pass < 200; pass++) {
    let changed = false;
    for (const [item, list] of candidatesFor) {
      for (const r of list) {
        const c = recipeCost(r, item);
        if (c === null) continue;
        const cur = cost.get(item);
        // Default recipe (first in list) wins ties so plans don't churn.
        if (cur === undefined || c < cur * (1 - 1e-9)) {
          cost.set(item, c);
          chosen.set(item, r);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  breakCycles(chosen);
  const vegan = new Set<string>([...raws, ...chosen.keys()]);

  const choices: Record<string, string> = {};
  const recipes: Recipe[] = [];
  for (const [item, r] of chosen) {
    if (producibleRecipes(lookup, item)[0]?.id === r.id) continue; // default already
    choices[item] = r.id;
    if (r.generated) recipes.push(r);
  }
  return { choices, recipes, vegan, plantRaws: raws, exclude, cost };
}
