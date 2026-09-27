import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';
import { defaultSettings } from '../src/model/settings';
import { solvePlan } from '../src/solver/solve';
import { computeHeat } from '../src/solver/heat';

const db = loadGameData();

function run(targets: Record<string, number>, mutate?: (s: ReturnType<typeof defaultSettings>) => void, overrides = {}) {
  const settings = defaultSettings();
  mutate?.(settings);
  const r = solvePlan(db, { targets: Object.entries(targets).map(([item, rate]) => ({ item, rate })), choices: {}, settings });
  return { r, h: computeHeat(db, r.lines, settings, overrides) };
}

describe('computeHeat', () => {
  it('Iron Smelter on a Stone Furnace burning Coke', () => {
    // 20 ingots/min => 2 smelters x 9 P/s = 18 P/s; Coke 600 P => 1.8 Coke/min.
    const { h } = run({ 'Iron Ingot': 20 }, s => (s.heating = 'Stone Furnace'));
    const lh = h.lines.get('Iron Ingot')!;
    expect(lh.heatPerSec).toBeCloseTo(18);
    expect(lh.fuelPerMin).toBeCloseTo(1.8);
    expect(lh.devices).toBe(2); // slotsRequired 9 on a 9-slot furnace
    expect(h.boiler).toBeNull();
  });

  it('steam pads move the same heat to the boiler bank', () => {
    const furnace = run({ 'Iron Ingot': 20 }, s => (s.heating = 'Stone Furnace')).h;
    const { h } = run({ 'Iron Ingot': 20 });
    const lh = h.lines.get('Iron Ingot')!;
    expect(lh.device).toBe('Steam Heating Pad');
    expect(lh.fuelPerMin).toBe(0);
    expect(lh.steamPerMin).toBeCloseTo((18 * 60) / 20); // 54 steam/min
    expect(h.boiler!.boilers).toBeCloseTo(54 / 9000);
    expect(h.boiler!.fuelPerMin).toBeCloseTo(furnace.totalFuelPerMin);
    expect(h.totalFuelPerMin).toBeCloseTo(furnace.totalFuelPerMin);
  });

  it('per-line override sends one line back to a furnace', () => {
    const { h } = run({ 'Steel Ingot': 1 }, undefined, { 'Iron Ingot': 'Stone Furnace' });
    expect(h.lines.get('Iron Ingot')!.device).toBe('Stone Furnace');
    expect(h.lines.get('Steel Ingot')!.device).toBe('Steam Heating Pad');
  });

  it('fuel efficiency reduces fuel items', () => {
    const base = run({ 'Iron Ingot': 20 }).h.totalFuelPerMin;
    const eff = run({ 'Iron Ingot': 20 }, s => (s.upgrades.fuel = 10)).h.totalFuelPerMin;
    expect(eff).toBeCloseTo(base / 2);
  });

  it('cauldron uses recipe heatCost', () => {
    const { h } = run({ 'Philosopherˈs Stone': 1 });
    expect(h.lines.get('Philosopherˈs Stone')!.heatPerSec).toBeCloseTo(10000);
  });
});

describe('boiler bank furnaces', () => {
  // 20 boilers' worth of steam: Iron Smelters at 9 P/s, 3000 P/s per boiler => 60000 P/s => 6667 smelters.
  const heavy = { 'Iron Ingot': (60000 / 9) * 10 };
  it('one boiler per Stone Furnace', () => {
    const b = run(heavy).h.boiler!;
    expect(b.boilersCeil).toBe(20);
    expect(b.furnaces).toBe(20);
  });
  it('four whole boilers per Blast Furnace', () => {
    const b = run(heavy, s => (s.furnace = 'Blast Furnace')).h.boiler!;
    expect(b.furnaces).toBe(5); // 20 / 4
    const b2 = run({ 'Iron Ingot': (60000 / 9) * 10 * (17 / 20) }, s => (s.furnace = 'Blast Furnace')).h.boiler!;
    expect(b2.boilersCeil).toBe(17);
    expect(b2.furnaces).toBe(5); // ceil(17/4); slot-packing would give ceil(153/42) = 4
  });
});
