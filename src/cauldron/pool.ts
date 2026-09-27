import type { GameData } from '../model/types';
import { EXTERNAL_MACHINES } from '../data/overrides';
import { isCandidate } from './engine';

/** Herbs grown in Nurseries / World Trees (items with a nutrientCost). */
export function grownSources(db: GameData): string[] {
  return Object.keys(db.items).filter(n => db.items[n].nutrientCost !== undefined && db.items[n].category === 'Herbs');
}

/** Raw materials bought from Purchasing Portals (seeds excluded: they only feed Seed Plots). */
export function boughtSources(db: GameData): string[] {
  return Object.keys(db.items).filter(n => db.items[n].category === 'Raw Materials' && !/Seeds?$/.test(n));
}

export const allSources = (db: GameData) => [...grownSources(db), ...boughtSources(db)];

/**
 * Cauldron ingredient pool for vegan mode: the enabled sources (grown herbs and bought
 * raws) plus everything reachable from them in `depth` processing steps
 * (e.g. Iron Ore -> Iron Ingot -> Iron Sand, Logs -> Plank -> Large Wooden Gear).
 * Like upstream's 🌿 preset, Seed Plot and cauldron recipes don't count as processing.
 * Excluded items are never added and can't be used as inputs.
 */
export function sourcePool(db: GameData, opts: { exclude?: Iterable<string>; depth?: number; rawInCauldron?: boolean } = {}): Set<string> {
  const exclude = new Set(opts.exclude ?? []);
  const reached = new Set(allSources(db).filter(n => !exclude.has(n)));
  for (let step = 0; step < (opts.depth ?? 2); step++) {
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
  // Bought raws go into the pool's processing steps, but by default not straight into a
  // cauldron: a whole purchased unit per slot is expensive, broken-down items are cheap.
  return new Set([...reached].filter(n => isCandidate(db, n) && (opts.rawInCauldron || db.items[n].category !== 'Raw Materials')));
}

export function allPool(db: GameData): Set<string> {
  return new Set(Object.keys(db.items).filter(n => isCandidate(db, n)));
}
