import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';
import { defaultSettings } from '../src/model/settings';
import { solvePlan, RAW } from '../src/solver/solve';
import { fmtCoins, rawCoinCost } from '../src/solver/coins';

const db = loadGameData();

describe('coin cost of bought raws', () => {
  it('Plank: 0.3 Logs/min x 200 = 60 coins/min', () => {
    const r = solvePlan(db, { targets: [{ item: 'Plank', rate: 60 }], choices: {}, settings: defaultSettings() });
    const c = rawCoinCost(db, r.raw);
    expect(c.perItem.Logs).toBeCloseTo(60);
    expect(c.total).toBeCloseTo(60);
  });
  it('Iron Ingot: 1 ore (1,200) per 100 ingots = 12 coins per ingot', () => {
    const r = solvePlan(db, { targets: [{ item: 'Iron Ingot', rate: 100 }], choices: {}, settings: defaultSettings() });
    expect(rawCoinCost(db, r.raw).total).toBeCloseTo(1200);
  });
  it("items marked raw that can't be bought have no price", () => {
    const r = solvePlan(db, { targets: [{ item: 'Steel Ingot', rate: 1 }], choices: { 'Coke Powder': RAW }, settings: defaultSettings() });
    expect(rawCoinCost(db, r.raw).perItem['Coke Powder']).toBeNull();
  });
  it('formats', () => {
    expect(fmtCoins(5.25)).toBe('5.3');
    expect(fmtCoins(1234)).toBe('1.2k');
    expect(fmtCoins(3_400_000)).toBe('3.4M');
  });
});
