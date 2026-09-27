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

/**
 * Paradox Crucible time (s) to turn one `item` into its output, as upstream
 * computeParadoxTime: the item's paradoxTime, else derived from its costs.
 */
export function paradoxTime(items: GameData['items'], item: string): number | null {
  const it = items[item];
  if (!it) return null;
  if (it.paradoxTime) return it.paradoxTime;
  let baseCost = it.baseCost ?? 0;
  const { cauldronCost, cauldronTarget, maxStack } = it;
  if (!(baseCost > 0) || !(cauldronCost! > 0) || !(cauldronTarget! > 0)) return null;
  if (maxStack !== undefined && maxStack < 0) baseCost *= -maxStack;
  const t = 1500 / (baseCost * (cauldronCost! / cauldronTarget!));
  return t > 0 && isFinite(t) ? t : null;
}

/**
 * "Custom input" recipes (Paradox Crucible: any item -> Oblivion Essence) become one
 * concrete recipe per usable item, e.g. "Oblivion Essence (Paradox: Lavender)".
 * Items that already have an explicit recipe for the same output are skipped.
 */
function expandCustomInput(items: GameData['items'], recipes: Recipe[]): Recipe[] {
  const out: Recipe[] = [];
  for (const r of recipes) {
    if (!r.customInputSlot) {
      out.push(r);
      continue;
    }
    const outputs = Object.keys(r.outputs);
    const explicit = new Set(
      recipes.filter(x => !x.customInputSlot && x.machine === r.machine && outputs.some(o => x.outputs[o])).flatMap(x => Object.keys(x.inputs)),
    );
    // Grown/crafted items first, bought raws (incl. seeds) last.
    const order = Object.keys(items).sort((a, b) => Number(items[a].category === 'Raw Materials') - Number(items[b].category === 'Raw Materials'));
    for (const item of order) {
      if (outputs.includes(item) || explicit.has(item) || items[item].virtual) continue;
      const t = paradoxTime(items, item);
      if (t === null) continue;
      const { customInputSlot: _drop, ...rest } = r;
      out.push({ ...rest, id: `${outputs[0]} (Paradox: ${item})`, inputs: { [item]: 1 }, baseTime: t });
    }
  }
  return out;
}

export function buildGameData(raw: RawDb): GameData {
  const recipes = expandCustomInput(
    raw.items,
    raw.recipes.map(r => ({ ...r, inputs: r.inputs ?? {} })),
  );
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
