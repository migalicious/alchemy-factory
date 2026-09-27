import type { GameData, Recipe } from '../model/types';
import { defaultSettings, type Settings } from '../model/settings';
import { findLoop, recipeLookup, solvePlan, type Choices, type Target } from '../solver/solve';
import type { HeatingOverrides } from '../solver/heat';
import { recipeFromId } from '../cauldron/engine';
import { veganPlan, type VeganGoal, type VeganPlan } from '../cauldron/vegan';

export interface PlanState {
  targets: Target[];
  /** User recipe picks (DB recipe id, cauldron:* id, or 'raw'). Override vegan picks. */
  choices: Choices;
  heating: HeatingOverrides;
  settings: Settings;
  vegan: boolean;
  /** Plant sources switched off + items to avoid in vegan mode. */
  veganExclude: string[];
  /** Processing steps from plant sources allowed as cauldron ingredients. */
  veganDepth: number;
  veganGoal: VeganGoal;
  /** Allow bought raws straight into cauldrons (off: only broken-down products). */
  veganRawInCauldron: boolean;
}

/** Off by default: World Tree (huge, fertilizer-hungry) and pricey raws (buy price in comments). */
export const EXPENSIVE_RAWS = ['Pyrite Ore' /* 11k */, 'Quartz Ore' /* 44k */, 'Meteorite' /* 2M */];
export const DEFAULT_VEGAN_EXCLUDE = ['World Tree Leaf', 'World Tree Core', ...EXPENSIVE_RAWS];

/** Bumped when saved-plan meaning changes; see sanitize() migrations. */
const PLAN_VERSION = 2;

/** Research levels the planner opens with (the owner's current game, 2026-09-27). */
export const DEFAULT_UPGRADES = { logistics: 6, factory: 6, alchemy: 2, fuel: 4, fert: 9 };

export const defaultPlan = (): PlanState => ({
  targets: [{ item: 'Philosopherˈs Stone', rate: 1 }],
  choices: {},
  heating: {},
  settings: { ...defaultSettings(), upgrades: { ...DEFAULT_UPGRADES } },
  vegan: false,
  veganExclude: [...DEFAULT_VEGAN_EXCLUDE],
  veganDepth: 2,
  veganGoal: 'buildings',
  veganRawInCauldron: false,
});

const veganCache = new Map<string, VeganPlan>();
function cachedVegan(db: GameData, opts: Parameters<typeof veganPlan>[1] & object): VeganPlan {
  // Only settings that change the scoring go in the key (fuel, steam, stacks etc. don't).
  const st = opts.settings;
  const key = JSON.stringify({ ...opts, settings: st && { u: st.upgrades, f: st.fertilizer, h: st.heating, p: st.preferMachines, a: st.avoidMachines } });
  let v = veganCache.get(key);
  if (!v) {
    if (veganCache.size > 30) veganCache.clear();
    veganCache.set(key, (v = veganPlan(db, opts)));
  }
  return v;
}

/** 2 significant figures, so small rate changes reuse the cached vegan plan. */
const round2 = (x: number) => (x > 0 ? Number(x.toPrecision(2)) : 0);

/**
 * Vegan picks for this plan. Two passes: score with the target rate, solve, then
 * re-score each item at the rate that plan actually needs it (Plank for relics runs
 * far above the 0.1/min target), so line-count vs throughput is judged per item.
 */
export function veganFor(db: GameData, plan: PlanState): VeganPlan {
  const base = {
    exclude: [...plan.veganExclude].sort(),
    depth: plan.veganDepth,
    prefer: plan.settings.preferMachines,
    avoid: plan.settings.avoidMachines,
    goal: plan.veganGoal,
    rawInCauldron: plan.veganRawInCauldron,
    settings: plan.settings,
  };
  const targets = plan.targets.filter(t => t.rate > 0);
  const rateHint = round2(targets.reduce((a, t) => a + t.rate, 0) || 1);
  const first = cachedVegan(db, { ...base, rateHint });
  if (plan.veganGoal !== 'buildings' || !targets.length) return first;
  const r = solvePlan(db, { targets, choices: { ...first.choices, ...plan.choices }, extraRecipes: first.recipes, settings: plan.settings });
  if (r.status !== 'optimal') return first;
  const rates: Record<string, number> = {};
  for (const l of r.lines) for (const [item, q] of Object.entries(l.outputs)) rates[item] = round2((rates[item] ?? 0) + q);
  return cachedVegan(db, { ...base, rateHint, rates });
}

/** Choices + generated recipes the solver should use for this plan. */
export function effectiveChoices(
  db: GameData,
  plan: PlanState,
): { choices: Choices; extraRecipes: Recipe[]; vegan?: VeganPlan; /** auto picks dropped because they looped with a user pick */ dropped: string[] } {
  const extra = new Map<string, Recipe>();
  let choices: Choices = { ...plan.choices };
  let vegan: VeganPlan | undefined;
  if (plan.vegan) {
    vegan = veganFor(db, plan);
    for (const r of vegan.recipes) extra.set(r.id, r);
    choices = { ...vegan.choices, ...plan.choices };
  }
  for (const id of Object.values(plan.choices)) {
    if (id.startsWith('cauldron:') && !extra.has(id)) {
      const r = recipeFromId(db, id);
      if (r) extra.set(id, r);
    }
  }
  const extraRecipes = [...extra.values()];
  // A user pick can close a loop with an automatic (vegan) pick, e.g. Iron Sand from
  // Iron Ingot while vegan makes Iron Ingot from Iron Sand. The user wins: the auto
  // picks in that loop go back to their default recipes.
  const dropped: string[] = [];
  const user = Object.keys(plan.choices);
  if (vegan && user.length) {
    const lookup = recipeLookup(db, extraRecipes, plan.settings.preferMachines, plan.settings.avoidMachines);
    for (let i = 0; i < 20; i++) {
      const loop = findLoop(lookup, choices, [...plan.targets.map(t => t.item), ...user]);
      if (!loop || !loop.some(item => item in plan.choices)) break;
      const auto = loop.filter(item => !(item in plan.choices) && choices[item] !== undefined);
      if (!auto.length) break;
      for (const item of auto) {
        delete choices[item];
        dropped.push(item);
      }
    }
  }
  return { choices, extraRecipes, vegan, dropped };
}

// --- (de)serialisation: URL hash + localStorage -------------------------------------

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export function encodePlan(plan: PlanState): string {
  return toBase64Url(JSON.stringify({ v: PLAN_VERSION, ...plan }));
}

/** Parse and sanitise a plan; unknown items/fields are dropped. Returns null if unusable. */
export function decodePlan(db: GameData, encoded: string): PlanState | null {
  try {
    const raw = JSON.parse(fromBase64Url(encoded));
    return sanitize(db, raw);
  } catch {
    return null;
  }
}

export function sanitize(db: GameData, raw: unknown): PlanState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PlanState> & { veganLogs?: boolean; v?: number };
  // v1 plans predate bought-ore sources: keep pricey raws off and use the new 2-step default.
  const v1 = (r.v ?? 1) < 2;
  const base = defaultPlan();
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);
  const s = (r.settings ?? {}) as Partial<Settings>;
  const u = (s.upgrades ?? {}) as Partial<Settings['upgrades']>;
  const devices = ['Stone Furnace', 'Blast Furnace', 'Steam Heating Pad'];
  const strMap = (m: unknown, ok: (k: string, v: string) => boolean) =>
    Object.fromEntries(Object.entries(typeof m === 'object' && m ? m : {}).filter(([k, v]) => typeof v === 'string' && ok(k, v)));
  return {
    targets: Array.isArray(r.targets)
      ? r.targets.filter(t => t && db.items[t.item]).map(t => ({ item: t.item, rate: num(t.rate, 1) }))
      : base.targets,
    choices: strMap(r.choices, k => !!db.items[k]),
    heating: strMap(r.heating, (_, v) => devices.includes(v)) as PlanState['heating'],
    settings: {
      upgrades: {
        logistics: num(u.logistics, base.settings.upgrades.logistics),
        factory: num(u.factory, base.settings.upgrades.factory),
        alchemy: num(u.alchemy, base.settings.upgrades.alchemy),
        fuel: num(u.fuel, base.settings.upgrades.fuel),
        fert: num(u.fert, base.settings.upgrades.fert),
      },
      fuel: s.fuel && db.items[s.fuel]?.heat ? s.fuel : base.settings.fuel,
      fertilizer: s.fertilizer && db.items[s.fertilizer]?.nutrientValue ? s.fertilizer : base.settings.fertilizer,
      heating: devices.includes(s.heating as string) ? (s.heating as Settings['heating']) : base.settings.heating,
      furnace: s.furnace === 'Blast Furnace' ? 'Blast Furnace' : 'Stone Furnace',
      preferMachines: Array.isArray(s.preferMachines)
        ? s.preferMachines.filter(m => typeof m === 'string' && db.machines[m])
        : base.settings.preferMachines,
      avoidMachines: Array.isArray(s.avoidMachines)
        ? s.avoidMachines.filter(m => typeof m === 'string' && db.machines[m])
        : base.settings.avoidMachines,
      steamSupply: s.steamSupply === 'boilers' ? 'boilers' : 'existing',
      stacks:
        s.stacks && typeof s.stacks === 'object'
          ? Object.fromEntries(
              Object.entries(s.stacks).filter(([m, n]) => db.machines[m] && typeof n === 'number' && n >= 1 && n <= 20).map(([m, n]) => [m, Math.floor(n)]),
            )
          : base.settings.stacks,
    },
    vegan: !!r.vegan,
    veganExclude: [
      ...new Set([
        ...(Array.isArray(r.veganExclude)
          ? r.veganExclude.filter(i => typeof i === 'string' && db.items[i])
          : // links from before per-source options: veganLogs=false meant "no logs"
            [...DEFAULT_VEGAN_EXCLUDE, ...(r.veganLogs === false ? ['Logs', 'Rotten Log'] : [])]),
        ...(v1 ? EXPENSIVE_RAWS : []),
      ]),
    ],
    veganDepth: Math.min(4, Math.max(0, Math.floor(v1 && (r.veganDepth ?? 1) === 1 ? 2 : num(r.veganDepth, 2)))),
    veganGoal: r.veganGoal === 'coins' ? 'coins' : 'buildings',
    veganRawInCauldron: r.veganRawInCauldron === true,
  };
}

const STORAGE_KEY = 'af-planner:last-plan';

export function saveLocal(plan: PlanState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: PLAN_VERSION, ...plan }));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

export function loadLocal(db: GameData): PlanState | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? sanitize(db, JSON.parse(s)) : null;
  } catch {
    return null;
  }
}
