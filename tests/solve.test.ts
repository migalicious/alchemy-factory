import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';
import { defaultSettings } from '../src/model/settings';
import { RAW, solvePlan, type Choices } from '../src/solver/solve';

const db = loadGameData();
const plan = (targets: Record<string, number>, choices: Choices = {}, settings = defaultSettings()) =>
  solvePlan(db, { targets: Object.entries(targets).map(([item, rate]) => ({ item, rate })), choices, settings });

describe('solvePlan', () => {
  it('simple chain: Plank from Logs', () => {
    // Plank: 1 Logs -> 200 Plank in 400 s => 30 Plank/min per Table Saw.
    const r = plan({ Plank: 60 });
    expect(r.status).toBe('optimal');
    const line = r.lines.find(l => l.recipe.id === 'Plank')!;
    expect(line.machines).toBeCloseTo(2);
    expect(r.raw.Logs).toBeCloseTo(0.3);
  });

  it('factory efficiency speeds machines up', () => {
    const s = defaultSettings();
    s.upgrades.factory = 4; // x2
    const line = plan({ Plank: 60 }, {}, s).lines.find(l => l.recipe.id === 'Plank')!;
    expect(line.machines).toBeCloseTo(1);
  });

  it('belt speed caps per-machine output', () => {
    const s = defaultSettings();
    s.upgrades.factory = 12; // x4 => 120 Plank/min raw, but belt is 60/min at logistics 0
    const line = plan({ Plank: 120 }, {}, s).lines.find(l => l.recipe.id === 'Plank')!;
    expect(line.machines).toBeCloseTo(2);
  });

  it('Steel Ingot byproduct Iron Ingot is recycled', () => {
    // Athanor: 4 Iron + 4 Coke Powder -> 1 Steel + 3 Iron. Net 1 Iron per Steel.
    const r = plan({ 'Steel Ingot': 1 });
    expect(r.status).toBe('optimal');
    const smelter = r.lines.find(l => l.recipe.id === 'Iron Ingot')!;
    expect(smelter.outputs['Iron Ingot']).toBeCloseTo(1);
    expect(r.lines.find(l => l.recipe.id === 'Steel Ingot')!.inputs['Coke Powder']).toBeCloseTo(4);
    expect(r.surplus['Iron Ingot'] ?? 0).toBeCloseTo(0);
  });

  it('treating an item as raw cuts its subtree', () => {
    const r = plan({ 'Steel Ingot': 1 }, { 'Coke Powder': RAW });
    expect(r.raw['Coke Powder']).toBeCloseTo(4);
    expect(r.lines.some(l => l.recipe.id === 'Coke Powder')).toBe(false);
  });

  it('Iron Ingot <-> Iron Sand loop with no outside source is infeasible', () => {
    const r = plan({ 'Iron Ingot': 1 }, { 'Iron Ingot': 'Iron Ingot 2' });
    expect(r.status).toBe('infeasible');
  });

  it("Philosopher's Stone solves end to end", () => {
    const r = plan({ 'Philosopherˈs Stone': 1 });
    expect(r.status).toBe('optimal');
    const ps = r.lines.find(l => l.recipe.id === 'Philosopherˈs Stone')!;
    expect(ps.machines).toBeCloseTo(1); // 60 s batch => 1/min per cauldron
    expect(Object.keys(r.raw).length).toBeGreaterThan(0);
  });

  it('every producible item solves with default recipes', () => {
    const bad: string[] = [];
    for (const item of Object.keys(db.items)) {
      if (!db.recipesByOutput.get(item)?.length) continue;
      const r = plan({ [item]: 1 });
      if (r.status !== 'optimal') bad.push(`${item}: ${r.status}`);
    }
    expect(bad).toEqual([]);
  });
});
