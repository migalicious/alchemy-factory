import type { GameData, Recipe } from '../model/types';
import { YIELD_MULTIPLIER_MACHINES } from '../model/multipliers';
import { cauldronRecipe, type CauldronType } from './engine';
import { sourcePool } from './pool';
import { findCombos, multiStep } from './search';
import { buildItemBaseCost } from './cost';
import { batchesPerMachine, producibleRecipes, recipeLookup } from '../solver/solve';
import { defaultSettings, mults, type Settings } from '../model/settings';

export interface VeganOptions {
  /** Plant sources switched off plus any items to avoid (never used as vegan ingredients). */
  exclude?: Iterable<string>;
  /** Processing steps from plant sources that count as cauldron ingredients. */
  depth?: number;
  /** Let bought raws go straight into cauldrons (default: only their processed products). */
  rawInCauldron?: boolean;
  cauldron?: CauldronType;
  /** Preferred / avoided machines (so "default" matches the solver's default). */
  prefer?: readonly string[];
  avoid?: readonly string[];
  /** What "best" means when several plant-based recipes exist. */
  goal?: VeganGoal;
  /** Plan settings (speeds, fertilizer) used to count buildings. */
  settings?: Settings;
  /**
   * Items/min each item is needed at (from a previous solve), and a fallback rate. Every
   * production line costs at least one building, so at low rates fewer steps matter
   * more than machine throughput: score = rate x machines-per-(item/min) + lines.
   */
  rates?: Record<string, number>;
  rateHint?: number;
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
  /** Raw inputs you allow buying from Purchasing Portals (not excluded). */
  allowedRaws: Set<string>;
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

export function allowedRaws(db: GameData, exclude: Set<string>): Set<string> {
  return new Set(Object.keys(db.items).filter(n => db.items[n].category === 'Raw Materials' && !exclude.has(n)));
}

/**
 * 🌿 Vegan mode: pick recipes from the sources you allow: herbs grown in Nurseries
 * and the raw materials you're happy to buy (cheap ores yes, Quartz/Meteorite no).
 * Producers = DB recipes + cauldron combos found by the upstream-style multi-step
 * search over the plant pool. Each item gets its cheapest plant-based recipe by
 * estimated copper cost (ties go to the default recipe).
 */
export function veganPlan(db: GameData, opts: VeganOptions = {}): VeganPlan {
  const exclude = new Set(opts.exclude ?? []);
  const raws = allowedRaws(db, exclude);
  const pool = sourcePool(db, { exclude, depth: opts.depth ?? 2, rawInCauldron: opts.rawInCauldron });
  const combos = multiStep(db, pool, opts.cauldron ?? 'Cauldron');
  const lookup = recipeLookup(db, [], opts.prefer ?? [], opts.avoid ?? opts.settings?.avoidMachines ?? []);
  // Cauldron candidates per item: the multi-step search's best, plus the cheapest
  // single-step combos over the pool and everything the search reached, so the
  // building-count score can prefer e.g. Redcurrant x2 + Sage for Clay.
  const cauldron = new Map<string, Recipe[]>();
  const addCombo = (item: string, type: CauldronType, inputs: string[]) => {
    if (exclude.has(item) || inputs.some(i => exclude.has(i))) return;
    if (!opts.rawInCauldron && inputs.some(i => db.items[i].category === 'Raw Materials')) return;
    const r = cauldronRecipe(db, type, inputs, item);
    const list = cauldron.get(item) ?? [];
    if (!list.some(x => x.id === r.id)) list.push(r);
    cauldron.set(item, list);
  };
  for (const [item, e] of combos) if (e.combo) addCombo(item, e.combo.type, e.combo.inputs);
  // Every combo straight from the pool (a few thousand), plus the cheapest few that also
  // use cauldron-made intermediates.
  for (const [item, list] of findCombos(db, pool, { limitPerOutput: Infinity })) for (const c of list) addCombo(item, c.type, c.inputs);
  const wide = findCombos(db, new Set([...pool, ...combos.keys()].filter(i => !exclude.has(i))), { limitPerOutput: 12 });
  for (const [item, list] of wide) for (const c of list) addCombo(item, c.type, c.inputs);

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
  const bought = raws; // bought from Purchasing Portals

  const candidatesFor = new Map<string, Recipe[]>();
  for (const item of Object.keys(db.items)) {
    if (exclude.has(item) || bought.has(item)) continue;
    // Transmuters (Paradox Crucible) eat whole bought units too; same rule as cauldrons.
    const rawIntoTransmuter = (r: Recipe) =>
      !opts.rawInCauldron && r.machine === 'Paradox Crucible' && Object.keys(r.inputs).some(i => db.items[i]?.category === 'Raw Materials');
    const list = producibleRecipes(lookup, item).filter(r => !r.generated && !rawIntoTransmuter(r));
    list.push(...(cauldron.get(item) ?? []));
    if (list.length) candidatesFor.set(item, list);
  }

  /** One relaxation with a fixed estimate of what a fertilizer item costs. */
  const rateOf = (item: string) => opts.rates?.[item] ?? opts.rateHint ?? 1;
  const relax = (fertEst: number) => {
    // cost = machines per 1 item/min (buildings) or copper per item (coins);
    // lines = production lines in the item's chain (buildings only).
    const cost = new Map<string, number>();
    const lines = new Map<string, number>();
    for (const r of bought) {
      cost.set(r, goal === 'coins' ? base.get(r) ?? 0 : 0); // buying from a portal needs no production machines
      lines.set(r, 0);
    }
    const chosen = new Map<string, Recipe>();
    const score = new Map<string, number>();
    const evaluate = (r: Recipe, item: string): { cost: number; lines: number } | null => {
      let sum = 0;
      let steps = 1;
      for (const [i, q] of Object.entries(r.inputs)) {
        const c = cost.get(i);
        if (c === undefined) return null;
        sum += c * q;
        steps += lines.get(i) ?? 0;
      }
      const mach = db.machines[r.machine];
      if (goal === 'coins') {
        if (mach?.heatCost) sum += ((mach.heatCost > 0 ? mach.heatCost : r.heatCost ?? 0) * (r.baseTime || 1)) / HEAT_PER_COPPER; // P/s x s
        if (r.nutrientCost) sum += r.nutrientCost / NUTR_PER_COPPER;
        return { cost: sum / r.outputs[item], lines: 0 };
      }
      // Machines to run 1 batch/min, plus the heating pad/furnace share under heated ones.
      const perBatch = 1 / batchesPerMachine(db, r, settings, m);
      const heated = !!mach?.heatCost && (mach.heatCost > 0 || (r.heatCost ?? 0) > 0);
      sum += perBatch * (1 + (heated ? (mach!.slotsRequired ?? 1) / (db.machines[settings.heating]?.slots ?? 9) : 0));
      // Fertilizer items per batch x machines per fertilizer item.
      if (r.nutrientCost && fert?.nutrientValue) sum += (r.nutrientCost / (fert.nutrientValue * m.fert)) * fertEst;
      return { cost: sum / (r.outputs[item] * yieldMult(r, m.alchemy)), lines: steps };
    };
    const scoreOf = (item: string, e: { cost: number; lines: number }) => (goal === 'coins' ? e.cost : rateOf(item) * e.cost + e.lines);
    for (let pass = 0; pass < 200; pass++) {
      let changed = false;
      for (const [item, list] of candidatesFor) {
        for (const r of list) {
          const e = evaluate(r, item);
          if (e === null) continue;
          const sc = scoreOf(item, e);
          const cur = score.get(item);
          // Default recipe (first in list) wins ties so plans don't churn.
          if (cur === undefined || sc < cur * (1 - 1e-9)) {
            cost.set(item, e.cost);
            lines.set(item, e.lines);
            score.set(item, sc);
            chosen.set(item, r);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    return { cost, chosen };
  };
  // Growers need fertilizer and fertilizer needs grown herbs, so iterate: score with a
  // fertilizer estimate, re-estimate from the result, until it settles.
  let fertEst = 0;
  let { cost, chosen } = relax(fertEst);
  for (let i = 0; i < 8 && goal === 'buildings'; i++) {
    const next = cost.get(settings.fertilizer);
    if (next === undefined || Math.abs(next - fertEst) <= 1e-6 * Math.max(1, next)) break;
    fertEst = next;
    ({ cost, chosen } = relax(fertEst));
  }
  breakCycles(chosen);
  const vegan = new Set<string>([...bought, ...chosen.keys()]);

  const choices: Record<string, string> = {};
  const recipes: Recipe[] = [];
  for (const [item, r] of chosen) {
    if (producibleRecipes(lookup, item)[0]?.id === r.id) continue; // default already
    choices[item] = r.id;
    if (r.generated) recipes.push(r);
  }
  return { choices, recipes, vegan, allowedRaws: raws, exclude, cost };
}
