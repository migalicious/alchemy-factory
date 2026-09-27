import type { GameData } from '../model/types';
import { EXTERNAL_MACHINES } from '../data/overrides';
import { isCandidate } from './engine';

/** Plant sources: herbs grown in nurseries (items with a nutrientCost) plus logs. */
export function plantSources(db: GameData): string[] {
  const herbs = Object.keys(db.items).filter(n => db.items[n].nutrientCost !== undefined && db.items[n].category === 'Herbs');
  return [...herbs, ...['Logs', 'Rotten Log'].filter(n => db.items[n])];
}

/**
 * Cauldron ingredient pool for vegan mode: the enabled plant sources plus everything
 * reachable from them in `depth` processing steps (e.g. Logs -> Plank, Flax -> Flax Fiber).
 * Like upstream's 🌿 preset, Seed Plot and cauldron recipes don't count as processing.
 * Excluded items are never added and can't be used as inputs.
 */
export function plantPool(db: GameData, opts: { exclude?: Iterable<string>; depth?: number } = {}): Set<string> {
  const exclude = new Set(opts.exclude ?? []);
  const reached = new Set(plantSources(db).filter(n => !exclude.has(n)));
  for (let step = 0; step < (opts.depth ?? 1); step++) {
    const fresh: string[] = [];
    for (const r of db.recipes) {
      if (r.machine === 'Seed Plot' || r.machine === 'Cauldron' || r.machine === 'Advanced Cauldron' || EXTERNAL_MACHINES.has(r.machine)) continue;
      const ins = Object.keys(r.inputs);
      if (!ins.length || !ins.every(i => reached.has(i))) continue;
      for (const o of Object.keys(r.outputs)) if (!reached.has(o) && !exclude.has(o)) fresh.push(o);
    }
    if (!fresh.length) break;
    for (const o of fresh) reached.add(o);
  }
  return new Set([...reached].filter(n => isCandidate(db, n)));
}

export function allPool(db: GameData): Set<string> {
  return new Set(Object.keys(db.items).filter(n => isCandidate(db, n)));
}
