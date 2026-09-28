import type { GameData } from '../model/types';
import { cauldronStats, cauldronTargets, isCandidate, resolve2, resolve3, type CauldronType } from './engine';
import { buildItemBaseCost } from './cost';

export interface Combo {
  type: CauldronType;
  inputs: string[];
  output: string;
  /** Estimated copper cost per output, using base costs of the inputs + heat. */
  cost: number | null;
  cauldronCostSum: number;
}

export interface SearchOptions {
  heatPerCopper?: number;
  nutrPerCopper?: number;
  /** Keep only the N cheapest combos per output (findCombos). */
  limitPerOutput?: number;
}

function comboCost(db: GameData, base: Map<string, number>, inputs: string[], output: string, heatPerCopper: number): number | null {
  let cost = 0;
  for (const i of inputs) {
    const c = base.get(i);
    if (c === undefined) return null;
    cost += c;
  }
  const s = cauldronStats(db.items[output].cauldronTarget ?? 0);
  return cost + (s.heat * s.time) / heatPerCopper;
}

/** Every single-step combo from `pool` (both cauldron types), grouped by output. */
export function findCombos(db: GameData, pool: Iterable<string>, opts: SearchOptions = {}): Map<string, Combo[]> {
  const hpc = opts.heatPerCopper ?? 20;
  const base = buildItemBaseCost(db, hpc, opts.nutrPerCopper ?? 12);
  const targets = cauldronTargets(db);
  const list = [...pool].filter(n => isCandidate(db, n)).sort((a, b) => db.items[b].cauldronCost! - db.items[a].cauldronCost!);
  const out = new Map<string, Combo[]>();
  const fixed = fixedCauldronInputs(db);
  const add = (type: CauldronType, inputs: string[], output: string | null) => {
    if (!output || inputs.includes(output)) return;
    if (fixed.has(inputKey(type, inputs))) return;
    const combo: Combo = {
      type,
      inputs,
      output,
      cost: comboCost(db, base, inputs, output, hpc),
      cauldronCostSum: inputs.reduce((a, i) => a + db.items[i].cauldronCost!, 0),
    };
    const list = out.get(output);
    if (list) list.push(combo);
    else out.set(output, [combo]);
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i; j < list.length; j++) {
      add('Advanced Cauldron', [list[i], list[j]], resolve2(db, [list[i], list[j]], targets));
      for (let k = j; k < list.length; k++) {
        add('Cauldron', [list[i], list[j], list[k]], resolve3(db, [list[i], list[j], list[k]], targets));
      }
    }
  }
  for (const [k, combos] of out) out.set(k, combos.sort(byCost).slice(0, opts.limitPerOutput ?? 40));
  return out;
}

const inputKey = (type: CauldronType, inputs: string[]) => `${type}|${[...inputs].sort().join('+')}`;

/**
 * Input sets of the DB's fixed cauldron recipes (e.g. Ruby). Those don't follow the
 * cost-matching rule, so a generated combo with the same inputs would be wrong.
 */
export function fixedCauldronInputs(db: GameData): Set<string> {
  const keys = new Set<string>();
  for (const r of db.recipes) {
    if (r.machine !== 'Cauldron' && r.machine !== 'Advanced Cauldron') continue;
    const ins: string[] = [];
    for (const [k, v] of Object.entries(r.inputs)) for (let i = 0; i < Math.round(v); i++) ins.push(k);
    keys.add(inputKey(r.machine, ins));
  }
  return keys;
}

export const byCost = (a: Combo, b: Combo) =>
  (a.cost ?? Infinity) - (b.cost ?? Infinity) || a.cauldronCostSum - b.cauldronCostSum;

export interface StepEntry {
  cost: number;
  cauldronCostSum: number;
  combo: Combo | null; // null = came from the pool itself
}

/**
 * Multi-step search (upstream runMultiStepCauldronSimulation): start from the pool's
 * base costs, then for up to `steps` rounds combine anything reachable so far, keeping
 * a combo whenever it's cheaper (ties -> smaller cauldronCost sum). At most
 * `intermediateLimit` inputs of a combo may themselves be cauldron-made.
 */
export function multiStep(
  db: GameData,
  pool: Iterable<string>,
  type: CauldronType,
  opts: SearchOptions & { steps?: number; intermediateLimit?: number } = {},
): Map<string, StepEntry> {
  const hpc = opts.heatPerCopper ?? 20;
  const limit = opts.intermediateLimit ?? 3;
  const base = buildItemBaseCost(db, hpc, opts.nutrPerCopper ?? 12);
  const targets = cauldronTargets(db);
  const fixed = fixedCauldronInputs(db);
  let prev = new Map<string, StepEntry>();
  for (const n of pool) {
    if (!isCandidate(db, n)) continue;
    const c = base.get(n);
    if (c !== undefined) prev.set(n, { cost: c, cauldronCostSum: db.items[n].cauldronCost!, combo: null });
  }
  const better = (a: StepEntry, b?: StepEntry) =>
    !b || a.cost < b.cost - 1e-9 || (Math.abs(a.cost - b.cost) < 1e-9 && a.cauldronCostSum < b.cauldronCostSum);

  for (let step = 1; step <= (opts.steps ?? 4); step++) {
    const names = [...prev.keys()];
    const round = new Map<string, StepEntry>();
    const consider = (inputs: string[], output: string | null) => {
      if (!output || inputs.includes(output)) return;
      if (fixed.has(inputKey(type, inputs))) return;
      let cost = 0;
      let sum = 0;
      let intermediates = 0;
      for (const i of inputs) {
        const e = prev.get(i)!;
        cost += e.cost;
        sum += db.items[i].cauldronCost!;
        if (e.cost !== base.get(i)) intermediates++;
      }
      if (intermediates > limit) return;
      const s = cauldronStats(db.items[output].cauldronTarget ?? 0);
      cost += (s.heat * s.time) / hpc;
      const cand: StepEntry = { cost, cauldronCostSum: sum, combo: { type, inputs, output, cost, cauldronCostSum: sum } };
      if (better(cand, round.get(output))) round.set(output, cand);
    };
    for (let i = 0; i < names.length; i++) {
      for (let j = i; j < names.length; j++) {
        if (type === 'Advanced Cauldron') {
          consider([names[i], names[j]], resolve2(db, [names[i], names[j]], targets));
        } else {
          for (let k = j; k < names.length; k++) {
            consider([names[i], names[j], names[k]], resolve3(db, [names[i], names[j], names[k]], targets));
          }
        }
      }
    }
    const next = new Map(prev);
    for (const [k, v] of round) if (better(v, next.get(k))) next.set(k, v);
    prev = next;
  }
  return prev;
}

/**
 * Every combo that contains `ingredient` (once or more) plus other items from `pool`,
 * optionally only those making `output`. Like upstream's "Set Input" slot filter.
 */
export function findCombosWith(db: GameData, pool: Iterable<string>, ingredient: string, output?: string, opts: SearchOptions = {}): Combo[] {
  if (!isCandidate(db, ingredient)) return [];
  const hpc = opts.heatPerCopper ?? 20;
  const base = buildItemBaseCost(db, hpc, opts.nutrPerCopper ?? 12);
  const targets = cauldronTargets(db);
  const fixed = fixedCauldronInputs(db);
  const list = [...new Set([ingredient, ...pool])].filter(n => isCandidate(db, n));
  const out: Combo[] = [];
  const seen = new Set<string>();
  const add = (type: CauldronType, inputs: string[], res: string | null) => {
    if (!res || inputs.includes(res) || (output && res !== output)) return;
    const key = inputKey(type, inputs);
    if (fixed.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ type, inputs, output: res, cost: comboCost(db, base, inputs, res, hpc), cauldronCostSum: inputs.reduce((a, i) => a + db.items[i].cauldronCost!, 0) });
  };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    add('Advanced Cauldron', [ingredient, a], resolve2(db, [ingredient, a], targets));
    for (let j = i; j < list.length; j++) {
      const b = list[j];
      add('Cauldron', [ingredient, a, b], resolve3(db, [ingredient, a, b], targets));
    }
  }
  return out.sort(byCost).slice(0, opts.limitPerOutput ?? 50);
}
