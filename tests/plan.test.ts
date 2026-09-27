import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';
import { decodePlan, defaultPlan, effectiveChoices, encodePlan } from '../src/state/plan';

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
