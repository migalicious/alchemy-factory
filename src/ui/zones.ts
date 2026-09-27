import type { App } from './app';

/** A build zone = all lines that run on the same machine type. */
export interface Zone {
  id: string; // machine name, or 'raw' / 'target' / 'surplus' / 'boiler'
  machine?: string;
  lines: App['result']['lines'];
  machines: number; // whole machines
  items: string[]; // items this zone makes
}

export const zoneOf = (lineOrNode: string, app: App): string => {
  if (lineOrNode.startsWith('raw:')) return 'raw';
  if (lineOrNode.startsWith('target:')) return 'target';
  if (lineOrNode.startsWith('surplus:')) return 'surplus';
  if (lineOrNode === 'boiler') return 'boiler';
  const line = app.result.lines.find(l => l.recipe.id === lineOrNode);
  return line ? `m:${line.recipe.machine}` : 'raw';
};

export function buildZones(app: App): Zone[] {
  const zones = new Map<string, Zone>();
  for (const l of app.result.lines) {
    const id = `m:${l.recipe.machine}`;
    const z = zones.get(id) ?? { id, machine: l.recipe.machine, lines: [], machines: 0, items: [] };
    z.lines.push(l);
    z.machines += l.machinesCeil;
    for (const i of l.items) if (!z.items.includes(i)) z.items.push(i);
    zones.set(id, z);
  }
  return [...zones.values()].sort((a, b) => b.machines - a.machines);
}

/** Item flows between zones (intra-zone flows dropped), aggregated per pair and item. */
export function zoneFlows(app: App): { from: string; to: string; items: Map<string, number> }[] {
  const pairs = new Map<string, { from: string; to: string; items: Map<string, number> }>();
  for (const f of app.result.flows) {
    const from = zoneOf(f.from, app);
    const to = zoneOf(f.to, app);
    if (from === to) continue;
    const key = `${from}→${to}`;
    const p = pairs.get(key) ?? { from, to, items: new Map() };
    p.items.set(f.item, (p.items.get(f.item) ?? 0) + f.rate);
    pairs.set(key, p);
  }
  return [...pairs.values()];
}

/** Footprint in tiles for a zone's machines given stacking per floor. */
export function footprint(app: App, machine: string, count: number) {
  const m = app.db.machines[machine];
  const stack = app.plan.settings.stacks[machine] ?? 1;
  const L = m?.L ?? 1;
  const W = m?.W ?? 1;
  const columns = Math.ceil(count / stack);
  return { L, W, H: m?.H ?? 1, stack, columns, tiles: columns * L * W };
}
