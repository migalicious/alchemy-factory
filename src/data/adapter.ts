import dbSource from './alchemy_db.js?raw';
import type { GameData, Recipe } from '../model/types';

interface RawDb {
  version: number;
  date: string;
  gameVersion: string;
  items: GameData['items'];
  machines: GameData['machines'];
  recipes: Recipe[];
}

/** Evaluate the vendored script (it assigns window.ALCHEMY_DB) without touching the real window. */
function evaluate(source: string): RawDb {
  const sandbox: { ALCHEMY_DB?: RawDb } = {};
  new Function('window', source)(sandbox);
  if (!sandbox.ALCHEMY_DB) throw new Error('alchemy_db.js did not define ALCHEMY_DB');
  return sandbox.ALCHEMY_DB;
}

export function buildGameData(raw: RawDb): GameData {
  const recipes = raw.recipes
    // Paradox "custom input" needs a user-chosen input; out of MVP scope.
    .filter(r => !r.customInputSlot)
    .map(r => ({ ...r, inputs: r.inputs ?? {} }));
  const recipesByOutput = new Map<string, Recipe[]>();
  const recipesById = new Map<string, Recipe>();
  for (const r of recipes) {
    recipesById.set(r.id, r);
    for (const out of Object.keys(r.outputs)) {
      const list = recipesByOutput.get(out) ?? [];
      list.push(r);
      recipesByOutput.set(out, list);
    }
  }
  return { ...raw, recipes, recipesByOutput, recipesById };
}

let cached: GameData | undefined;
export function loadGameData(): GameData {
  cached ??= buildGameData(evaluate(dbSource));
  return cached;
}
