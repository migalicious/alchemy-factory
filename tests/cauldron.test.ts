import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';
import { cauldronRecipe, cauldronStats, cauldronTargets, recipeFromId, resolve3 } from '../src/cauldron/engine';
import { sourcePool, grownSources, boughtSources } from '../src/cauldron/pool';
import { findCombos } from '../src/cauldron/search';
import { veganPlan } from '../src/cauldron/vegan';
import { defaultSettings } from '../src/model/settings';
import { solvePlan } from '../src/solver/solve';

const db = loadGameData();
const targets = cauldronTargets(db);

describe('cauldron engine', () => {
  it('interpolates time/heat on cauldronTarget breakpoints', () => {
    expect(cauldronStats(1)).toEqual({ time: 3, heat: 1 });
    expect(cauldronStats(100)).toEqual({ time: 6, heat: 20 });
    expect(cauldronStats(5500)).toEqual({ time: 18, heat: 850 });
    expect(cauldronStats(2e6)).toEqual({ time: 60, heat: 10000 });
  });

  it("reproduces the DB's official cauldron recipes that follow the cost rule", () => {
    expect(resolve3(db, ['Ruby', 'Sapphire', 'Emerald'], targets)).toBe('Philosopherˈs Stone');
    expect(resolve3(db, ['Perfect Diamond', 'World Tree Core', 'Unstable Catalyst'], targets)).toBe('Sapphire');
    expect(resolve3(db, ['Moonlit Soap', 'Lapis Lazuli', 'Fertile Catalyst'], targets)).toBe('Emerald');
  });

  it('never offers a combo that collides with a fixed DB recipe (Ruby)', () => {
    const combos = findCombos(db, ['Diamond', 'Gold Dust', 'Resonant Catalyst']);
    const all = [...combos.values()].flat();
    expect(all.some(c => [...c.inputs].sort().join() === ['Diamond', 'Gold Dust', 'Resonant Catalyst'].sort().join())).toBe(false);
  });

  it('generated recipe round-trips through its id', () => {
    const r = cauldronRecipe(db, 'Cauldron', ['Flax', 'Flax', 'Flax'], 'Stone');
    expect(r.inputs).toEqual({ Flax: 3 });
    expect(recipeFromId(db, r.id)?.outputs).toEqual({ Stone: 1 });
  });
});

describe('herb pool and vegan mode', () => {
  it('source pool = grown + bought sources + N processing steps', () => {
    const pool = sourcePool(db, { depth: 1, exclude: ['Meteorite'] }); // Meteorite Processing yields Iron Sand in 1 step
    for (const n of ['Flax', 'Sage', 'Gentian', 'World Tree Core', 'Flax Fiber', 'Plant Ash', 'Oblivion Essence', 'Logs', 'Plank', 'Iron Ore', 'Iron Ingot']) expect(pool.has(n), n).toBe(true);
    expect(pool.has('Iron Sand')).toBe(false); // ore -> ingot -> sand is 2 steps
    const two = sourcePool(db); // default depth 2
    for (const n of ['Iron Sand', 'Large Wooden Gear', 'Linen Thread']) expect(two.has(n), n).toBe(true);
    expect(sourcePool(db, { depth: 0 }).has('Plank')).toBe(false);
  });

  it('excluded sources and their products stay out of the pool', () => {
    const pool = sourcePool(db, { exclude: ['World Tree Leaf', 'World Tree Core', 'Quartz Ore'] });
    expect(pool.has('World Tree Core')).toBe(false);
    expect(pool.has('Quartz Ore')).toBe(false);
    expect(grownSources(db)).toContain('World Tree Leaf');
    expect(boughtSources(db)).toContain('Iron Ore');
    expect(boughtSources(db)).not.toContain('Flax Seeds');
  });

  it('vegan mode never uses excluded items in its own picks', () => {
    const exclude = ['World Tree Leaf', 'World Tree Core'];
    const v = veganPlan(db, { exclude });
    expect(v.vegan.has('World Tree Core')).toBe(false);
    for (const r of v.recipes) for (const i of Object.keys(r.inputs)) expect(exclude, `${r.id}`).not.toContain(i);
  });

  it("vegan Philosopher's Stone uses no mined raw materials", () => {
    const v = veganPlan(db);
    const r = solvePlan(db, { targets: [{ item: 'Philosopherˈs Stone', rate: 1 }], choices: v.choices, extraRecipes: v.recipes, settings: defaultSettings() });
    expect(r.status).toBe('optimal');
    for (const raw of Object.keys(r.raw)) expect(v.allowedRaws.has(raw), raw).toBe(true);
  });

  it('every vegan-reachable item solves using only plant raws', () => {
    const v = veganPlan(db);
    const bad: string[] = [];
    for (const item of v.vegan) {
      if (v.allowedRaws.has(item)) continue;
      const r = solvePlan(db, { targets: [{ item, rate: 1 }], choices: v.choices, extraRecipes: v.recipes, settings: defaultSettings() });
      const nonPlant = Object.keys(r.raw).filter(k => !v.allowedRaws.has(k));
      if (r.status !== 'optimal' || nonPlant.length) bad.push(`${item}: ${r.status} ${nonPlant.join(',')}`);
    }
    expect(bad).toEqual([]);
  });

  it('without logs, wood items are not vegan', () => {
    const v = veganPlan(db, { exclude: ['Logs', 'Rotten Log'] });
    expect(v.allowedRaws.has('Logs')).toBe(false);
    expect(v.vegan.has('Plank')).toBe(false);
  });
});

describe('vegan goal', () => {
  const machinesFor = (goal: 'buildings' | 'coins', item: string, rate: number) => {
    const v = veganPlan(db, { exclude: ['World Tree Leaf', 'World Tree Core'], goal });
    const r = solvePlan(db, { targets: [{ item, rate }], choices: v.choices, extraRecipes: v.recipes, settings: defaultSettings() });
    return { r, total: r.lines.reduce((a, l) => a + l.machinesCeil, 0) };
  };
  it('fewest-buildings picks cauldron Clay', () => {
    const { r } = machinesFor('buildings', 'Clay', 10);
    expect(r.lines.find(l => l.items.includes('Clay'))!.recipe.machine).toBe('Cauldron');
  });
  it('fewest-buildings needs fewer machines than cheapest-coins', () => {
    expect(machinesFor('buildings', 'Moonlit Soap', 0.1).total).toBeLessThan(machinesFor('coins', 'Moonlit Soap', 0.1).total);
  });
});

describe('vegan coverage', () => {
  it('reaches most items from Nursery-grown plants (no Seed Plots)', () => {
    const v = veganPlan(db, { exclude: ['World Tree Leaf', 'World Tree Core'], settings: defaultSettings() });
    expect(defaultSettings().avoidMachines).toContain('Seed Plot');
    expect(v.vegan.size).toBeGreaterThan(120);
    expect(v.vegan.has('Iron Ingot')).toBe(true);
    expect(v.vegan.has('Salt')).toBe(true);
  });
  it("vegan Star Dust doesn't buy ores", () => {
    const v = veganPlan(db, { exclude: ['World Tree Leaf', 'World Tree Core'], settings: defaultSettings() });
    const r = solvePlan(db, { targets: [{ item: 'Star Dust', rate: 0.5 }], choices: v.choices, extraRecipes: v.recipes, settings: defaultSettings() });
    expect(r.status).toBe('optimal');
    for (const raw of Object.keys(r.raw)) expect(v.allowedRaws.has(raw), raw).toBe(true);
  });
});
