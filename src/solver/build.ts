import type { SolveResult } from './solve';

/** "Plan by buildings": fixed machine counts per line -> the output rate they reach. */
export interface BuildOutcome {
  /** Achievable output = aim x factor (all lines scale together). */
  factor: number;
  /** Machines per line (recipe id), defaults of 1 filled in. */
  counts: Record<string, number>;
  /** Share of each line's capacity used at the achievable rate (0..1). */
  util: Record<string, number>;
  /** Lines running at capacity (the choke points). */
  bottlenecks: string[];
  /** What adding one machine to each bottleneck line would reach. */
  next: { factor: number; add: string[] } | null;
}

/**
 * `aim` is the plan solved at the target rates. With fixed recipe choices every line's
 * machine need scales linearly with the output rate, so the reachable rate is
 * aim x min(count / machinesNeeded) over all lines.
 */
export function buildOutcome(aim: SolveResult, counts: Record<string, number>): BuildOutcome | null {
  const lines = aim.lines.filter(l => l.machines > 1e-9);
  if (!lines.length) return null;
  const full: Record<string, number> = {};
  for (const l of lines) full[l.recipe.id] = Math.max(1, Math.floor(counts[l.recipe.id] ?? 1));
  const factorWith = (c: Record<string, number>) => Math.min(...lines.map(l => c[l.recipe.id] / l.machines));
  const factor = factorWith(full);
  const util: Record<string, number> = {};
  for (const l of lines) util[l.recipe.id] = (l.machines * factor) / full[l.recipe.id];
  const bottlenecks = lines.filter(l => util[l.recipe.id] > 1 - 1e-6).map(l => l.recipe.id);
  const bumped = { ...full };
  for (const id of bottlenecks) bumped[id] += 1;
  const nextFactor = factorWith(bumped);
  return { factor, counts: full, util, bottlenecks, next: nextFactor > factor * (1 + 1e-9) ? { factor: nextFactor, add: bottlenecks } : null };
}
