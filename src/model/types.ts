// Shapes of the vendored starfi5h DB (src/data/alchemy_db.js). Only fields we use.

export interface ItemDef {
  id: number;
  category: string;
  tier: number;
  heat?: number; // fuel value in P
  buyPrice?: number;
  sellPrice?: number;
  maxStack?: number; // negative ⇒ bulk raw (one buy = -maxStack units)
  nutrientCost?: number;
  nutrientValue?: number;
  maxFertility?: number;
  cauldronCost?: number;
  cauldronTarget?: number;
  cauldronMulti?: number;
  liquid?: boolean;
  virtual?: boolean;
  charges?: number;
}

export interface MachineDef {
  heatCost?: number; // P/s; -1 ⇒ per-recipe heatCost
  slotsRequired?: number;
  heatSelf?: number;
  slots?: number;
  isGenerator?: boolean;
  fertility?: boolean;
  tier: number;
  buildCost?: Record<string, number>;
}

export interface Recipe {
  id: string;
  machine: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  baseTime?: number;
  heatCost?: number;
  nutrientCost?: number;
  sharedOutputs?: number;
  customInputSlot?: boolean;
  ChargeCost?: number;
  /** Set on cauldron combos we generate. */
  generated?: 'cauldron';
}

export interface GameData {
  version: number;
  date: string;
  gameVersion: string;
  items: Record<string, ItemDef>;
  machines: Record<string, MachineDef>;
  recipes: Recipe[];
  recipesByOutput: Map<string, Recipe[]>;
  recipesById: Map<string, Recipe>;
}

export type HeatingDevice = 'Stone Furnace' | 'Blast Furnace' | 'Steam Heating Pad';

export interface Upgrades {
  logistics: number;
  factory: number;
  alchemy: number;
  fuel: number;
}
