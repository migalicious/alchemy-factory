// Upgrade formulas, as implemented in starfi5h js/alchemy_calc_engine.js + alchemy_calc.js.

/** Factory Efficiency: machine speed (and heat draw) multiplier. */
export function speedMult(lvl: number): number {
  return 1 + Math.min(lvl, 12) * 0.25 + Math.max(0, lvl - 12) * 0.05;
}

/** Alchemy Skill: yield multiplier for YIELD_MULTIPLIER_MACHINES. */
export function alchemyMult(lvl: number): number {
  let percent = 0;
  for (let i = 1; i <= lvl; i++) percent += i <= 2 ? 6 : i <= 8 ? 8 : 10;
  return 1 + percent / 100;
}

/** Fuel Efficiency: multiplier on a fuel item's heat value. */
export function fuelMult(lvl: number): number {
  return 1 + lvl * 0.1;
}

/** Logistics: belt speed in items/min. */
export function beltSpeed(lvl: number): number {
  return 60 + Math.min(lvl, 12) * 15 + Math.max(0, lvl - 12) * 3;
}

export const YIELD_MULTIPLIER_MACHINES = ['Extractor', 'Thermal Extractor', 'Alembic', 'Advanced Alembic'];

/** Steam item value in P (starfi5h alchemy_calc.js: "Steam = 20 P"). */
export const STEAM_P = 20;
