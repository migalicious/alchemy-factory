import type { GameData } from '../model/types';

/**
 * Estimated per-unit copper value of items (upstream buildItemBaseCost):
 * buyPrice / Currency sellPrice / nutrientCost / nutrPerCopper as seeds, divided by
 * -maxStack for bulk raws, then propagated through single-output non-cauldron recipes
 * including heat converted at heatPerCopper.
 */
export function buildItemBaseCost(db: GameData, heatPerCopper = 20, nutrPerCopper = 12): Map<string, number> {
  const cache = new Map<string, number>();
  for (const [name, it] of Object.entries(db.items)) {
    let cost: number | null = null;
    if (it.buyPrice && it.buyPrice > 0) cost = it.buyPrice;
    else if (it.category === 'Currency') cost = it.sellPrice ?? null;
    else if (it.nutrientCost && it.nutrientCost > 0) cost = it.nutrientCost / nutrPerCopper;
    if (cost !== null && it.maxStack && it.maxStack < 0) cost /= -it.maxStack;
    if (cost !== null) cache.set(name, cost);
  }
  const fixed: [string, number][] = [
    ['Crude Silver Powder', 1500],
    ['Silver Ingot', 6000],
    ['Crude Gold Dust', 12500],
    ['Gold Ingot', 100000],
  ];
  for (const [n, v] of fixed) if (db.items[n] && !cache.has(n)) cache.set(n, v);

  for (;;) {
    const fresh = new Map<string, number>();
    for (const r of db.recipes) {
      if (r.machine === 'Cauldron' || r.machine === 'Advanced Cauldron') continue;
      const outs = Object.keys(r.outputs);
      if (outs.length !== 1) continue;
      const out = outs[0];
      if (cache.has(out) || fresh.has(out)) continue;
      const ins = Object.keys(r.inputs);
      if (ins.length === 0 || !ins.every(k => cache.has(k))) continue;
      let inputSum = 0;
      for (const k of ins) {
        const ms = db.items[k]?.maxStack ?? 0;
        inputSum += cache.get(k)! * (ms < 0 ? -ms : 1) * r.inputs[k];
      }
      const mach = db.machines[r.machine];
      let heat = 0;
      if (mach?.heatCost) heat = mach.heatCost > 0 ? mach.heatCost * (r.baseTime || 1) : r.heatCost || 0;
      const unit = (inputSum + heat / heatPerCopper) / r.outputs[out];
      const ms = db.items[out]?.maxStack ?? 0;
      fresh.set(out, ms < 0 ? unit / -ms : unit);
    }
    if (fresh.size === 0) break;
    for (const [k, v] of fresh) cache.set(k, v);
  }
  return cache;
}
