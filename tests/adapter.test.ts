import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/adapter';

describe('game data adapter', () => {
  const db = loadGameData();
  it('loads the vendored DB', () => {
    expect(db.version).toBe(56);
    expect(Object.keys(db.items).length).toBe(157);
    expect(db.recipesByOutput.get('Iron Ingot')?.map(r => r.id)).toContain('Iron Ingot');
  });
  it('drops custom-input recipes', () => {
    expect(db.recipesById.has('Oblivion Essence (Custom)')).toBe(false);
  });
  it('every recipe references known items and machines', () => {
    for (const r of db.recipes) {
      expect(db.machines[r.machine], r.machine).toBeDefined();
      for (const k of [...Object.keys(r.inputs), ...Object.keys(r.outputs)]) expect(db.items[k], k).toBeDefined();
    }
  });
});
