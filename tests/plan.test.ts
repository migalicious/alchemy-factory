import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';
import { decodePlan, defaultPlan, effectiveChoices, encodePlan } from '../src/state/plan';
import { solvePlan } from '../src/solver/solve';

const db = loadGameData();

describe('plan state', () => {
  it('round-trips through the URL encoding (incl. unicode item names)', () => {
    const p = defaultPlan();
    p.choices = { Stone: 'cauldron:3:Flax+Flax+Flax', 'Coke Powder': 'raw' };
    p.heating = { 'Iron Ingot': 'Stone Furnace' };
    p.vegan = true;
    p.settings.upgrades.factory = 7;
    expect(decodePlan(db, encodePlan(p))).toEqual(p);
  });

  it('migrates old links: veganLogs=false excludes logs', () => {
    const old = btoa(JSON.stringify({ targets: [], vegan: true, veganLogs: false }));
    expect(decodePlan(db, old)?.veganExclude).toEqual(['World Tree Leaf', 'World Tree Core', 'Pyrite Ore', 'Quartz Ore', 'Meteorite', 'Logs', 'Rotten Log']);
  });

  it('migrates v1 plans: pricey raws off, 2 processing steps', () => {
    const old = btoa(JSON.stringify({ v: 1, targets: [], vegan: true, veganExclude: ['World Tree Core'], veganDepth: 1 }));
    const p = decodePlan(db, old)!;
    expect(p.veganExclude).toEqual(['World Tree Core', 'Pyrite Ore', 'Quartz Ore', 'Meteorite']);
    expect(p.veganDepth).toBe(2);
  });

  it('drops garbage', () => {
    expect(decodePlan(db, 'not-base64!!')).toBeNull();
    const p = decodePlan(db, btoa(JSON.stringify({ targets: [{ item: 'Nope', rate: 1 }], settings: { fuel: 'Nope' } })));
    expect(p?.targets).toEqual([]);
    expect(p?.settings.fuel).toBe('Coke');
  });

  it('user picks override vegan picks and cauldron ids become recipes', () => {
    const p = defaultPlan();
    p.vegan = true;
    p.choices = { Stone: 'Stone' };
    const e = effectiveChoices(db, p);
    expect(e.choices.Stone).toBe('Stone');
    p.vegan = false;
    p.choices = { Stone: 'cauldron:3:Flax+Flax+Flax' };
    expect(effectiveChoices(db, p).extraRecipes.map(r => r.id)).toEqual(['cauldron:3:Flax+Flax+Flax']);
  });
});

describe('user picks that loop with vegan picks', () => {
  it('Iron Sand from the grinder sends vegan Iron Ingot back to its smelter', () => {
    const p = defaultPlan();
    p.vegan = true;
    p.targets = [{ item: 'Star Dust', rate: 0.5 }];
    p.veganExclude = [...p.veganExclude, 'Iron Ore']; // so vegan makes Iron Ingot from Iron Sand
    p.choices = { 'Iron Sand': 'Iron Sand (Enhanced)' };
    const e = effectiveChoices(db, p);
    expect(e.dropped).toContain('Iron Ingot');
    const r = solvePlan(db, { targets: p.targets, choices: e.choices, extraRecipes: e.extraRecipes, settings: p.settings });
    expect(r.status).toBe('optimal');
    expect(r.lines.find(l => l.items.includes('Iron Ingot'))!.recipe.machine).toBe('Iron Smelter');
  });

  it('a loop made only of user picks is reported by name', () => {
    const p = defaultPlan();
    p.targets = [{ item: 'Iron Ingot', rate: 1 }];
    p.choices = { 'Iron Ingot': 'Iron Ingot 2', 'Iron Sand': 'Iron Sand (Enhanced)' };
    const e = effectiveChoices(db, p);
    const r = solvePlan(db, { targets: p.targets, choices: e.choices, extraRecipes: e.extraRecipes, settings: p.settings });
    expect(r.status).toBe('infeasible');
    expect(r.message).toMatch(/Iron Ingot → Iron Sand → Iron Ingot/);
  });
});
