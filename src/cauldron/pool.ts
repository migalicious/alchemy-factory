import type { GameData } from '../model/types';
import { isCandidate } from './engine';

/**
 * 🌿 Herb ("vegan") pool, as upstream getPresetCandidates('Herbs'):
 * herbs (items with cauldronCost + nutrientCost), plus one round of single-output
 * recipes whose inputs are all herbs (skipping Seed Plot and cauldrons).
 */
export function herbPool(db: GameData): Set<string> {
  const pool = new Set<string>();
  const herbs = new Set<string>();
  for (const [name, it] of Object.entries(db.items)) {
    if (it.cauldronCost !== undefined && it.nutrientCost !== undefined) {
      pool.add(name);
      herbs.add(name);
    }
  }
  for (const r of db.recipes) {
    if (r.machine === 'Seed Plot' || r.machine === 'Cauldron' || r.machine === 'Advanced Cauldron') continue;
    const ins = Object.keys(r.inputs);
    const outs = Object.keys(r.outputs);
    if (ins.length >= 1 && outs.length === 1 && ins.every(k => herbs.has(k)) && isCandidate(db, outs[0])) pool.add(outs[0]);
  }
  return new Set([...pool].filter(n => isCandidate(db, n)));
}

export function allPool(db: GameData): Set<string> {
  return new Set(Object.keys(db.items).filter(n => isCandidate(db, n)));
}
