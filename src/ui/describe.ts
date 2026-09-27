import type { GameData, Recipe } from '../model/types';
import { fmt } from './dom';

export function recipeSummary(r: Recipe): string {
  const side = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([k, v]) => `${fmt(v, 3)} ${k}`)
      .join(' + ') || '—';
  const time = r.nutrientCost ? `${r.nutrientCost} nutrients` : `${fmt(r.baseTime ?? 1)} s`;
  return `${side(r.inputs)} → ${side(r.outputs)} · ${time}`;
}

export function recipeLabel(r: Recipe): string {
  if (r.generated === 'cauldron') return `${r.machine}: ${Object.keys(r.inputs).length > 0 ? cauldronInputs(r).join(' + ') : ''}`;
  return r.id === Object.keys(r.outputs)[0] ? r.machine : `${r.machine} (${r.id})`;
}

export function cauldronInputs(r: Recipe): string[] {
  const m = /^cauldron:[23]:(.+)$/.exec(r.id);
  return m ? m[1].split('+') : Object.keys(r.inputs);
}

export function isHeated(db: GameData, r: Recipe): boolean {
  const m = db.machines[r.machine];
  return !!m?.heatCost && (m.heatCost > 0 || (r.heatCost ?? 0) > 0);
}
