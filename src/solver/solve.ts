import { solve as lpSolve, type Coefficients } from 'yalps';
import type { GameData, Recipe } from '../model/types';
import { EXTERNAL_MACHINES } from '../data/overrides';
import { YIELD_MULTIPLIER_MACHINES } from '../model/multipliers';
import { mults, type Mults, type Settings } from '../model/settings';

export interface Target {
  item: string;
  rate: number; // items per minute
}

/** Per-item recipe choice: a recipe id, or 'raw' to treat the item as an external input. */
export type Choices = Record<string, string>;
export const RAW = 'raw';

export interface PlanInput {
  targets: Target[];
  choices: Choices;
  /** Extra (generated) recipes, e.g. cauldron combos, addressable by id in `choices`. */
  extraRecipes?: Recipe[];
  settings: Settings;
}

export interface Line {
  recipe: Recipe;
  /** Items this line was chosen to produce (usually one). */
  items: string[];
  batchesPerMin: number;
  /** Machine count, fractional and rounded up. */
  machines: number;
  machinesCeil: number;
  /** Batches/min a single machine manages (after speed and belt caps). */
  batchesPerMachine: number;
  inputs: Record<string, number>; // per min
  outputs: Record<string, number>; // per min
  /** Fertilizer items/min (Nursery lines). */
  fertPerMin: number;
}

export interface Flow {
  item: string;
  from: string; // line recipe id, or `raw:<item>`
  to: string; // line recipe id, `target:<item>`, or `surplus:<item>`
  rate: number;
}

export interface SolveResult {
  status: 'optimal' | 'infeasible' | 'unbounded' | 'error';
  message?: string;
  lines: Line[];
  raw: Record<string, number>;
  surplus: Record<string, number>;
  flows: Flow[];
  fertPerMin: number;
}

const EPS = 1e-9;

/**
 * Recipe index for a plan. `prefer` lists machines whose recipes should be the
 * default when an item has several (e.g. Enhanced Grinder over Grinder).
 */
export function recipeLookup(db: GameData, extra: Recipe[] = [], prefer: readonly string[] = []) {
  const byId = new Map(db.recipesById);
  const byOutput = new Map<string, Recipe[]>();
  for (const [k, v] of db.recipesByOutput) byOutput.set(k, [...v]);
  for (const r of extra) {
    byId.set(r.id, r);
    for (const o of Object.keys(r.outputs)) byOutput.set(o, [...(byOutput.get(o) ?? []), r]);
  }
  return { byId, byOutput, prefer };
}

const sameIO = (a: Recipe, b: Recipe) =>
  JSON.stringify(Object.entries(a.inputs).sort()) === JSON.stringify(Object.entries(b.inputs).sort()) &&
  JSON.stringify(Object.entries(a.outputs).sort()) === JSON.stringify(Object.entries(b.outputs).sort());

/**
 * Recipes an item can be made with (no "buy it" portal recipes), in DB order, except
 * that a recipe on a preferred machine moves up in front of its identical-I/O twin
 * (e.g. "Sand (Enhanced)" ahead of Grinder "Sand"). Only exact twins are promoted, so
 * a preferred machine never changes which ingredients a chain uses.
 */
export function producibleRecipes(lookup: ReturnType<typeof recipeLookup>, item: string): Recipe[] {
  const list = (lookup.byOutput.get(item) ?? []).filter(r => !EXTERNAL_MACHINES.has(r.machine));
  if (!lookup.prefer.length) return list;
  const out: Recipe[] = [];
  for (const r of list) {
    if (out.includes(r)) continue;
    const twin = list.find(t => t !== r && !out.includes(t) && lookup.prefer.includes(t.machine) && !lookup.prefer.includes(r.machine) && sameIO(t, r));
    if (twin) out.push(twin);
    out.push(r);
  }
  return out;
}

export function defaultRecipe(lookup: ReturnType<typeof recipeLookup>, item: string): Recipe | undefined {
  return producibleRecipes(lookup, item).find(r => !r.generated);
}

/** The recipe used for an item, or undefined when it's a raw/external input. */
export function chosenRecipe(lookup: ReturnType<typeof recipeLookup>, choices: Choices, item: string): Recipe | undefined {
  const c = choices[item];
  if (c === RAW) return undefined;
  if (c) {
    const r = lookup.byId.get(c);
    if (r && r.outputs[item] !== undefined) return r;
  }
  return defaultRecipe(lookup, item);
}

export function outputYield(recipe: Recipe, item: string, m: Mults): number {
  const base = recipe.outputs[item] ?? 0;
  return YIELD_MULTIPLIER_MACHINES.includes(recipe.machine) ? base * m.alchemy : base;
}

export function recipeTime(db: GameData, recipe: Recipe, settings: Settings): number {
  if (recipe.nutrientCost && recipe.machine === 'Nursery') {
    return recipe.nutrientCost / (db.items[settings.fertilizer]?.maxFertility || 1);
  }
  return recipe.baseTime || 1;
}

/** Batches/min for one machine: speed-scaled, then capped by belt speed per solid output. */
export function batchesPerMachine(db: GameData, recipe: Recipe, settings: Settings, m: Mults): number {
  let rate = (60 / recipeTime(db, recipe, settings)) * (recipe.machine !== 'Seed Plot' ? m.speed : 1);
  for (const item of Object.keys(recipe.outputs)) {
    const def = db.items[item];
    if (!def || def.liquid) continue;
    let belt = m.belt;
    if (def.category === 'Currency') belt *= 50;
    else if (recipe.sharedOutputs) belt /= recipe.sharedOutputs;
    const y = outputYield(recipe, item, m);
    if (y > 0 && rate * y > belt) rate = belt / y;
  }
  return rate;
}

export function solvePlan(db: GameData, input: PlanInput): SolveResult {
  const { settings, choices } = input;
  const m = mults(settings);
  const lookup = recipeLookup(db, input.extraRecipes, settings.preferMachines);
  const empty: SolveResult = { status: 'optimal', lines: [], raw: {}, surplus: {}, flows: [], fertPerMin: 0 };

  const demand = new Map<string, number>();
  for (const t of input.targets) if (t.rate > 0 && db.items[t.item]) demand.set(t.item, (demand.get(t.item) ?? 0) + t.rate);
  if (demand.size === 0) return empty;

  // Discover active recipes (one per produced item) by walking inputs from targets.
  const active = new Map<string, Recipe>();
  const producedBy = new Map<string, Recipe>(); // item -> its chosen recipe
  const items = new Set<string>();
  const queue = [...demand.keys()];
  while (queue.length) {
    const item = queue.pop()!;
    if (items.has(item)) continue;
    items.add(item);
    const r = chosenRecipe(lookup, choices, item);
    if (!r) continue;
    producedBy.set(item, r);
    if (!active.has(r.id)) {
      active.set(r.id, r);
      for (const i of Object.keys(r.inputs)) queue.push(i);
      for (const o of Object.keys(r.outputs)) if (!items.has(o)) queue.push(o);
    }
  }

  // LP: variables = batches/min per recipe; for each produced item net output >= demand.
  // Minimise machine count (only matters when byproducts give a choice).
  const net = (r: Recipe, item: string) => outputYield(r, item, m) - (r.inputs[item] ?? 0);
  const variables: Record<string, Coefficients> = {};
  for (const r of active.values()) {
    const coeffs: Record<string, number> = { machines: 1 / batchesPerMachine(db, r, settings, m) };
    for (const item of new Set([...Object.keys(r.inputs), ...Object.keys(r.outputs)])) {
      if (producedBy.has(item)) coeffs[`i:${item}`] = net(r, item);
    }
    variables[r.id] = coeffs;
  }
  const constraints: Record<string, { min: number }> = {};
  for (const item of producedBy.keys()) constraints[`i:${item}`] = { min: demand.get(item) ?? 0 };

  const sol = lpSolve({ direction: 'minimize', objective: 'machines', constraints, variables });
  if (sol.status !== 'optimal') {
    return {
      ...empty,
      status: sol.status === 'infeasible' || sol.status === 'unbounded' ? sol.status : 'error',
      message:
        sol.status === 'infeasible'
          ? 'No way to satisfy this plan with the chosen recipes (probably a loop that consumes what it makes). Try a different recipe or mark an item as raw.'
          : `Solver status: ${sol.status}`,
    };
  }
  const rates = new Map(sol.variables);

  const lines: Line[] = [];
  const supply = new Map<string, { from: string; rate: number }[]>();
  const consume = new Map<string, { to: string; rate: number }[]>();
  const push = <T,>(map: Map<string, T[]>, k: string, v: T) => map.set(k, [...(map.get(k) ?? []), v]);
  let fertPerMin = 0;
  const fertDef = db.items[settings.fertilizer];

  for (const r of active.values()) {
    const x = rates.get(r.id) ?? 0;
    if (x <= EPS) continue;
    const bpm = batchesPerMachine(db, r, settings, m);
    const inputs: Record<string, number> = {};
    const outputs: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.inputs)) {
      inputs[k] = v * x;
      push(consume, k, { to: r.id, rate: v * x });
    }
    for (const k of Object.keys(r.outputs)) {
      outputs[k] = outputYield(r, k, m) * x;
      push(supply, k, { from: r.id, rate: outputs[k] });
    }
    const lineFert = r.nutrientCost && fertDef?.nutrientValue ? (x * r.nutrientCost) / (fertDef.nutrientValue * m.fert) : 0;
    fertPerMin += lineFert;
    const machines = x / bpm;
    lines.push({
      recipe: r,
      items: [...producedBy].filter(([, pr]) => pr.id === r.id).map(([i]) => i),
      batchesPerMin: x,
      machines,
      machinesCeil: Math.ceil(machines - 1e-6),
      batchesPerMachine: bpm,
      inputs,
      outputs,
      fertPerMin: lineFert,
    });
  }
  for (const [item, rate] of demand) push(consume, item, { to: `target:${item}`, rate });

  // Balance each item: shortfall is raw input, excess is surplus; allocate flows proportionally.
  const raw: Record<string, number> = {};
  const surplus: Record<string, number> = {};
  const flows: Flow[] = [];
  for (const item of new Set([...supply.keys(), ...consume.keys()])) {
    const sup = supply.get(item) ?? [];
    const con = consume.get(item) ?? [];
    const sTot = sup.reduce((a, b) => a + b.rate, 0);
    const cTot = con.reduce((a, b) => a + b.rate, 0);
    // LP results carry ~1e-6 relative noise; don't report that as raw/surplus.
    const tol = Math.max(1e-6, 1e-5 * Math.max(sTot, cTot));
    if (cTot - sTot > tol) {
      raw[item] = cTot - sTot;
      sup.push({ from: `raw:${item}`, rate: raw[item] });
    } else if (sTot - cTot > tol) {
      surplus[item] = sTot - cTot;
      con.push({ to: `surplus:${item}`, rate: surplus[item] });
    }
    const total = Math.max(sTot, cTot);
    if (total <= EPS) continue;
    for (const s of sup) for (const c of con) {
      const rate = (s.rate * c.rate) / total;
      if (rate > 1e-7) flows.push({ item, from: s.from, to: c.to, rate });
    }
  }

  return { status: 'optimal', lines, raw, surplus, flows, fertPerMin };
}
