// Cauldron combo mechanics, re-implemented from starfi5h js/alchemy_cauldron.js.
import type { GameData, Recipe } from '../model/types';

export type CauldronType = 'Cauldron' | 'Advanced Cauldron';

export interface CauldronTarget {
  name: string;
  id: number;
  target: number;
  mult: number;
}

/** Time (s) and heat (P/s) for a cauldron craft, interpolated on the output's cauldronTarget. */
export function cauldronStats(target: number): { time: number; heat: number } {
  const t = [1, 100, 1000, 10000, 1000000];
  const times = [3, 6, 12, 24, 60];
  const heats = [1, 20, 200, 1500, 10000];
  if (target <= t[0]) return { time: times[0], heat: heats[0] };
  if (target >= t[t.length - 1]) return { time: times[times.length - 1], heat: heats[heats.length - 1] };
  for (let i = 0; i < t.length - 1; i++) {
    if (target >= t[i] && target <= t[i + 1]) {
      const p = (target - t[i]) / (t[i + 1] - t[i]);
      return {
        time: Math.round((times[i] + p * (times[i + 1] - times[i])) * 10) / 10,
        heat: Math.round((heats[i] + p * (heats[i + 1] - heats[i])) * 10) / 10,
      };
    }
  }
  return { time: times[0], heat: heats[0] }; // unreachable
}

/** An item may go into a cauldron if it has a cauldronCost and isn't a liquid/virtual. */
export function isCandidate(db: GameData, name: string): boolean {
  const it = db.items[name];
  return !!it && it.cauldronCost !== undefined && !it.liquid && !it.virtual;
}

export function cauldronTargets(db: GameData): CauldronTarget[] {
  return Object.entries(db.items)
    .filter(([, it]) => it.cauldronTarget !== undefined)
    .map(([name, it]) => ({ name, id: it.id || 3000, target: it.cauldronTarget!, mult: it.cauldronMulti || 1 }));
}

/** 3-slot Cauldron: T = sum(cost) x ratio; nearest target (weighted by cauldronMulti), ties to lower id. */
export function resolve3(db: GameData, inputs: [string, string, string], targets: CauldronTarget[]): string | null {
  const [n0, n1, n2] = inputs;
  let ratio = 1.0;
  if (n0 === n1 && n1 === n2) ratio = 0.5;
  else if (n0 === n1 || n1 === n2 || n0 === n2) ratio = 0.65;
  const T = (db.items[n0].cauldronCost! + db.items[n1].cauldronCost! + db.items[n2].cauldronCost!) * ratio;
  if (T === 556) return 'Crude Shard'; // upstream tie-breaker patch
  let best: string | null = null;
  let bestId = 0;
  let minDist = Infinity;
  for (const tg of targets) {
    const dist = Math.abs((T - tg.target) * tg.mult);
    if (dist < minDist) {
      minDist = dist;
      best = tg.name;
      bestId = tg.id;
    } else if (Math.abs(dist - minDist) < 1e-7 && tg.id < bestId) {
      best = tg.name;
      bestId = tg.id;
    }
  }
  return best;
}

/** 2-slot Advanced Cauldron. Same+same: nearest target above cost. A+B: nearest to |a-b| below the higher cost. */
export function resolve2(db: GameData, inputs: [string, string], targets: CauldronTarget[]): string | null {
  const [nA, nB] = inputs;
  const cA = db.items[nA].cauldronCost!;
  const cB = db.items[nB].cauldronCost!;
  const maxT = targets.reduce((p, c) => (p.target > c.target ? p : c));
  const minT = targets.reduce((p, c) => (p.target < c.target ? p : c));
  let best: string | null;
  let minDist = Infinity;
  if (nA === nB) {
    best = maxT.name;
    for (const tg of targets) {
      const dist = tg.target - cA;
      if (1e-7 < dist && dist < minDist && tg.name !== nA) {
        minDist = dist;
        best = tg.name;
      }
    }
  } else {
    const T = Math.abs(cA - cB);
    const higherName = cA > cB ? nA : nB;
    const higherCost = Math.max(cA, cB);
    best = minT.name;
    for (const tg of targets) {
      const dist = Math.abs(T - tg.target);
      if (dist < minDist && tg.target < higherCost && tg.name !== higherName) {
        minDist = dist;
        best = tg.name;
      }
    }
  }
  return best;
}

export const cauldronRecipeId = (type: CauldronType, inputs: string[]) =>
  `cauldron:${type === 'Cauldron' ? 3 : 2}:${[...inputs].sort().join('+')}`;

/** Turn a combo into a solver recipe (same shape as upstream AUTO_GENERATED_CAULDRON). */
export function cauldronRecipe(db: GameData, type: CauldronType, inputs: string[], output: string): Recipe {
  const stats = cauldronStats(db.items[output].cauldronTarget ?? 0);
  const counts: Record<string, number> = {};
  for (const name of inputs) {
    const ms = db.items[name]?.maxStack;
    // Raw materials / relics (negative maxStack) only use a fraction of one unit per craft.
    counts[name] = (counts[name] ?? 0) + (ms && ms < 0 ? 1 / -ms : 1);
  }
  return {
    id: cauldronRecipeId(type, inputs),
    machine: type,
    inputs: counts,
    outputs: { [output]: 1 },
    baseTime: stats.time,
    heatCost: stats.heat,
    generated: 'cauldron',
  };
}

/** Parse an id made by cauldronRecipeId back into a recipe (used when restoring shared plans). */
export function recipeFromId(db: GameData, id: string): Recipe | null {
  const m = /^cauldron:([23]):(.+)$/.exec(id);
  if (!m) return null;
  const type: CauldronType = m[1] === '3' ? 'Cauldron' : 'Advanced Cauldron';
  const inputs = m[2].split('+');
  if (inputs.length !== Number(m[1]) || !inputs.every(i => isCandidate(db, i))) return null;
  const targets = cauldronTargets(db);
  const out = type === 'Cauldron' ? resolve3(db, inputs as [string, string, string], targets) : resolve2(db, inputs as [string, string], targets);
  return out && !inputs.includes(out) ? cauldronRecipe(db, type, inputs, out) : null;
}
