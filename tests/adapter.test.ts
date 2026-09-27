import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';

describe('game data adapter', () => {
  const db = loadGameData();
  it('loads the vendored DB', () => {
    expect(db.version).toBe(56);
    expect(Object.keys(db.items).length).toBe(157);
    expect(db.recipesByOutput.get('Iron Ingot')?.map(r => r.id)).toContain('Iron Ingot');
  });
  it('expands the Paradox Crucible custom-input recipe per item', () => {
    expect(db.recipesById.has('Oblivion Essence (Custom)')).toBe(false);
    const lav = db.recipesById.get('Oblivion Essence (Paradox: Lavender)')!;
    expect(lav.machine).toBe('Paradox Crucible');
    expect(lav.inputs).toEqual({ Lavender: 1 });
    expect(lav.baseTime).toBeCloseTo(8.333);
    // Explicit recipes aren't duplicated
    expect(db.recipesById.has('Oblivion Essence (Paradox: Gentian)')).toBe(false);
  });
  it('every recipe references known items and machines', () => {
    for (const r of db.recipes) {
      expect(db.machines[r.machine], r.machine).toBeDefined();
      for (const k of [...Object.keys(r.inputs), ...Object.keys(r.outputs)]) expect(db.items[k], k).toBeDefined();
    }
  });
});
