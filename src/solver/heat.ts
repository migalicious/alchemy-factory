import type { GameData, HeatingDevice } from '../model/types';
import { STEAM_P } from '../model/multipliers';
import { mults, type Settings } from '../model/settings';
import { STEAM_BOILER_RECIPE, STEAM_BOILER_SLOTS } from '../data/overrides';
import type { Line } from './solve';

/** Per-line heating override, keyed by recipe id. */
export type HeatingOverrides = Record<string, HeatingDevice>;

export interface LineHeat {
  recipeId: string;
  device: HeatingDevice;
  heatPerSec: number; // P/s
  devices: number; // furnaces or pads under this line
  /** True when the machine has no slotsRequired in the DB (we assume 1). */
  slotsAssumed: boolean;
  steamPerMin: number; // steam lines only
  fuelPerMin: number; // furnace lines only
}

export interface BoilerBank {
  steamPerMin: number;
  heatPerSec: number;
  boilers: number;
  boilersCeil: number;
  furnace: string;
  furnaces: number;
  fuelPerMin: number;
}

export interface HeatResult {
  lines: Map<string, LineHeat>;
  boiler: BoilerBank | null;
  totalHeatPerSec: number;
  totalFuelPerMin: number;
  devices: Record<string, number>; // device name -> count (incl. boiler furnaces)
}

export function computeHeat(db: GameData, lines: Line[], settings: Settings, overrides: HeatingOverrides = {}): HeatResult {
  const m = mults(settings);
  const fuelEnergy = (db.items[settings.fuel]?.heat ?? 0) * m.fuel; // P per fuel item
  const perFuel = (heatPerSec: number) => (fuelEnergy > 0 ? (heatPerSec * 60) / fuelEnergy : 0);
  const out = new Map<string, LineHeat>();
  const devices: Record<string, number> = {};
  let steamPerMin = 0;
  let totalHeat = 0;
  let totalFuel = 0;

  for (const line of lines) {
    const mach = db.machines[line.recipe.machine];
    if (!mach?.heatCost) continue;
    const active = (mach.heatCost > 0 ? mach.heatCost : line.recipe.heatCost ?? 0) * m.speed;
    if (active <= 0) continue;
    const heatPerSec = line.machines * active;
    const device = overrides[line.recipe.id] ?? settings.heating;
    const slots = db.machines[device]?.slots ?? 9;
    const slotsRequired = mach.slotsRequired ?? 1;
    const count = Math.ceil((line.machinesCeil * slotsRequired) / slots - 1e-9);
    devices[device] = (devices[device] ?? 0) + count;
    const isSteam = device === 'Steam Heating Pad';
    const lh: LineHeat = {
      recipeId: line.recipe.id,
      device,
      heatPerSec,
      devices: count,
      slotsAssumed: mach.slotsRequired === undefined,
      steamPerMin: isSteam ? (heatPerSec * 60) / STEAM_P : 0,
      fuelPerMin: isSteam ? 0 : perFuel(heatPerSec),
    };
    steamPerMin += lh.steamPerMin;
    totalHeat += heatPerSec;
    totalFuel += lh.fuelPerMin;
    out.set(line.recipe.id, lh);
  }

  let boiler: BoilerBank | null = null;
  if (steamPerMin > 1e-9) {
    const br = db.recipesById.get(STEAM_BOILER_RECIPE)!;
    const steamPerBoilerMin = ((br.outputs.Steam ?? 0) / (br.baseTime || 1)) * 60 * m.speed; // 9000/min at speed 1
    const boilers = steamPerMin / steamPerBoilerMin;
    const boilersCeil = Math.ceil(boilers - 1e-6);
    const heatPerSec = (steamPerMin * STEAM_P) / 60; // boiler turns furnace heat 1:1 into steam
    const furnace = settings.furnace;
    const furnaces = Math.ceil((boilersCeil * STEAM_BOILER_SLOTS) / (db.machines[furnace]?.slots ?? 9) - 1e-9);
    const fuelPerMin = perFuel(heatPerSec);
    devices[furnace] = (devices[furnace] ?? 0) + furnaces;
    devices['Steam Boiler'] = boilersCeil;
    totalFuel += fuelPerMin;
    boiler = { steamPerMin, heatPerSec, boilers, boilersCeil, furnace, furnaces, fuelPerMin };
  }

  return { lines: out, boiler, totalHeatPerSec: totalHeat, totalFuelPerMin: totalFuel, devices };
}
