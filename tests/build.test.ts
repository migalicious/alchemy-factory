import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';
import { defaultSettings } from '../src/model/settings';
import { solvePlan } from '../src/solver/solve';
import { buildOutcome } from '../src/solver/build';

const db = loadGameData();
const aim = (item: string, rate: number) => solvePlan(db, { targets: [{ item, rate }], choices: {}, settings: defaultSettings() });

describe('plan by buildings', () => {
  it('one machine per line: the slowest line sets the rate', () => {
    // Plank: 30/min per Table Saw at speed 1; aim 60/min needs 2 saws -> 1 saw gives half.
    const o = buildOutcome(aim('Plank', 60), {})!;
    expect(o.factor).toBeCloseTo(0.5);
    expect(o.bottlenecks).toEqual(['Plank']);
    expect(o.util.Plank).toBeCloseTo(1);
    expect(o.next!.factor).toBeCloseTo(1);
  });
  it('more machines on the bottleneck raise the rate until the next line chokes', () => {
    const a = aim('Steel Ingot', 5);
    const base = buildOutcome(a, {})!;
    const more = buildOutcome(a, Object.fromEntries(base.bottlenecks.map(id => [id, 2])))!;
    expect(more.factor).toBeGreaterThan(base.factor);
    for (const u of Object.values(more.util)) expect(u).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('lines that need less than one machine are not bottlenecks', () => {
    const o = buildOutcome(aim('Plank', 1), {})!;
    expect(o.factor).toBeGreaterThan(1); // one saw makes more than the 1/min aim
  });
});

describe('what to add to reach a rate', () => {
  it('Plank 60/min with 1 saw: add 1 (30/min each)', async () => {
    const { countsToReach } = await import('../src/solver/build');
    const r = countsToReach(aim('Plank', 60), 1, {});
    expect(r.need.Plank).toBe(2);
    expect(r.totalAdd).toBe(1);
  });
  it('applying the counts reaches the target exactly or better', async () => {
    const { countsToReach } = await import('../src/solver/build');
    const a = aim('Steel Ingot', 5);
    const { need } = countsToReach(a, 2, {}); // reach 10/min
    expect(buildOutcome(a, need)!.factor).toBeGreaterThanOrEqual(2 * (1 - 1e-6)); // LP noise ~1e-8
  });
  it('nothing to add when current counts already suffice', async () => {
    const { countsToReach } = await import('../src/solver/build');
    const a = aim('Plank', 60);
    expect(countsToReach(a, 1, { Plank: 5 }).totalAdd).toBe(0);
  });
});
