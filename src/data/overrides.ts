// Local corrections / assumptions not present in the vendored DB.

/**
 * Furnace slots a Steam Boiler occupies. The DB has no slotsRequired for it.
 * Player-reported (2026-09-27): a 3x3 boiler fills a whole Stone Furnace, and a
 * Blast Furnace fits more. Boilers are whole machines, so a furnace holds
 * floor(slots / 9): 1 per Stone Furnace, 4 per Blast Furnace (42 slots, 7x6).
 */
export const STEAM_BOILER_SLOTS = 9;

/** Steam Boiler (High) recipe id in the DB: 300 Steam / 2 s at 3000 P/s. */
export const STEAM_BOILER_RECIPE = 'Steam Boiler (High)';

/** Recipes on these machines are treated as "buy from outside" (raw input). */
export const EXTERNAL_MACHINES = new Set(['Purchasing Portal', 'Bank Portal']);
