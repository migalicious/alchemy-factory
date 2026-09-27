import type { HeatingDevice, Upgrades } from './types';
import { alchemyMult, beltSpeed, fuelMult, speedMult } from './multipliers';

export interface Settings {
  upgrades: Upgrades & { fert: number };
  /** Fuel item burned in furnaces (and under boilers). */
  fuel: string;
  /** Fertilizer item for Nursery lines. */
  fertilizer: string;
  /** Default heating device for heated machines. */
  heating: HeatingDevice;
  /** Furnace used when a line (or the boiler bank) burns fuel directly. */
  furnace: 'Stone Furnace' | 'Blast Furnace';
  /** Machines whose recipes become the default when an item has alternatives. */
  preferMachines: string[];
}

export const defaultSettings = (): Settings => ({
  upgrades: { logistics: 0, factory: 0, alchemy: 0, fuel: 0, fert: 0 },
  fuel: 'Coke',
  fertilizer: 'Basic Fertilizer',
  heating: 'Steam Heating Pad',
  furnace: 'Stone Furnace',
  preferMachines: ['Enhanced Grinder'],
});

export interface Mults {
  speed: number;
  alchemy: number;
  fuel: number;
  fert: number;
  belt: number;
}

export function mults(s: Settings): Mults {
  const u = s.upgrades;
  return {
    speed: speedMult(u.factory),
    alchemy: alchemyMult(u.alchemy),
    fuel: fuelMult(u.fuel),
    fert: 1 + u.fert * 0.1, // starfi5h alchemy_calc.js: fertMult = 1 + lvlFert * 0.10
    belt: beltSpeed(u.logistics),
  };
}
