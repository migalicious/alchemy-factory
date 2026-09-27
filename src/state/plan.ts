import type { GameData, Recipe } from '../model/types';
import { defaultSettings, type Settings } from '../model/settings';
import type { Choices, Target } from '../solver/solve';
import type { HeatingOverrides } from '../solver/heat';
import { recipeFromId } from '../cauldron/engine';
import { veganPlan, type VeganPlan } from '../cauldron/vegan';

export interface PlanState {
  targets: Target[];
  /** User recipe picks (DB recipe id, cauldron:* id, or 'raw'). Override vegan picks. */
  choices: Choices;
  heating: HeatingOverrides;
  settings: Settings;
  vegan: boolean;
  veganLogs: boolean;
}

export const defaultPlan = (): PlanState => ({
  targets: [{ item: 'Philosopherˈs Stone', rate: 1 }],
  choices: {},
  heating: {},
  settings: defaultSettings(),
  vegan: false,
  veganLogs: true,
});

const veganCache = new Map<boolean, VeganPlan>();
export function veganFor(db: GameData, includeLogs: boolean): VeganPlan {
  let v = veganCache.get(includeLogs);
  if (!v) veganCache.set(includeLogs, (v = veganPlan(db, { includeLogs })));
  return v;
}

/** Choices + generated recipes the solver should use for this plan. */
export function effectiveChoices(db: GameData, plan: PlanState): { choices: Choices; extraRecipes: Recipe[]; vegan?: VeganPlan } {
  const extra = new Map<string, Recipe>();
  let choices: Choices = { ...plan.choices };
  let vegan: VeganPlan | undefined;
  if (plan.vegan) {
    vegan = veganFor(db, plan.veganLogs);
    for (const r of vegan.recipes) extra.set(r.id, r);
    choices = { ...vegan.choices, ...plan.choices };
  }
  for (const id of Object.values(plan.choices)) {
    if (id.startsWith('cauldron:') && !extra.has(id)) {
      const r = recipeFromId(db, id);
      if (r) extra.set(id, r);
    }
  }
  return { choices, extraRecipes: [...extra.values()], vegan };
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
  return toBase64Url(JSON.stringify({ v: 1, ...plan }));
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
  const r = raw as Partial<PlanState>;
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
        logistics: num(u.logistics, 0),
        factory: num(u.factory, 0),
        alchemy: num(u.alchemy, 0),
        fuel: num(u.fuel, 0),
        fert: num(u.fert, 0),
      },
      fuel: s.fuel && db.items[s.fuel]?.heat ? s.fuel : base.settings.fuel,
      fertilizer: s.fertilizer && db.items[s.fertilizer]?.nutrientValue ? s.fertilizer : base.settings.fertilizer,
      heating: devices.includes(s.heating as string) ? (s.heating as Settings['heating']) : base.settings.heating,
      furnace: s.furnace === 'Blast Furnace' ? 'Blast Furnace' : 'Stone Furnace',
    },
    vegan: !!r.vegan,
    veganLogs: r.veganLogs !== false,
  };
}

const STORAGE_KEY = 'af-planner:last-plan';

export function saveLocal(plan: PlanState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
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
