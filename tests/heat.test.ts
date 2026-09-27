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
