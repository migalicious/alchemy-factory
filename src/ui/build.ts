import type { App } from './app';
import { fmt, h } from './dom';
import { buildZones, footprint, zoneFlows } from './zones';

const zoneName = (id: string) =>
  id === 'raw' ? 'outside (raw)' : id === 'target' ? 'output' : id === 'surplus' ? 'surplus' : id === 'boiler' ? 'boiler bank' : id.slice(2);

/** Build planner: one row per machine type (area to build), with footprint and stacking. */
export function renderBuild(app: App, root: HTMLElement): void {
  const { db, heat, plan } = app;
  const zones = buildZones(app);
  if (!zones.length) {
    root.replaceChildren(h('p', { class: 'muted pad' }, 'Add a target to get started.'));
    return;
  }
  const flows = zoneFlows(app);
  const stackInput = (machine: string) =>
    h('input', {
      type: 'number',
      min: 1,
      max: 20,
      value: plan.settings.stacks[machine] ?? 1,
      class: 'stack-input',
      'aria-label': `${machine} per floor`,
      onchange: (e: Event) =>
        app.update(p => {
          const n = Math.min(20, Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value) || 1)));
          if (n === 1) delete p.settings.stacks[machine];
          else p.settings.stacks[machine] = n;
        }),
    });
  const flowList = (dir: 'in' | 'out', id: string) =>
    flows
      .filter(f => (dir === 'in' ? f.to === id : f.from === id))
      .map(f => h('div', { class: 'small' }, h('span', { class: 'muted' }, `${dir === 'in' ? '← ' : '→ '}${zoneName(dir === 'in' ? f.from : f.to)}: `), [...f.items].map(([i, r]) => `${fmt(r)} ${i}`).join(', ')));

  const rows = zones.map(z => {
    const fp = footprint(app, z.machine!, z.machines);
    return h(
      'tr',
      {},
      h('td', {}, h('strong', {}, z.machine!), h('div', { class: 'muted small' }, z.lines.map(l => `${l.items.join(' + ')} ×${l.machinesCeil}`).join(' · '))),
      h('td', { class: 'num' }, h('strong', {}, `${z.machines}`)),
      h('td', { class: 'num' }, `${fp.L}×${fp.W}×${fp.H}`),
      h('td', { class: 'num' }, stackInput(z.machine!)),
      h('td', { class: 'num' }, `${fp.columns} × ${fp.L * fp.W} = `, h('strong', {}, `${fp.tiles}`)),
      h('td', {}, ...flowList('in', z.id)),
      h('td', {}, ...flowList('out', z.id)),
    );
  });

  // Heating devices are their own build items.
  const devices = Object.entries(heat.devices).filter(([, n]) => n > 0);
  const deviceRows = devices.map(([d, n]) => {
    const fp = footprint(app, d, n);
    return h(
      'tr',
      { class: 'boiler-row' },
      h('td', {}, h('strong', {}, d), h('div', { class: 'muted small' }, d === 'Steam Boiler' ? 'boiler bank' : 'under heated machines')),
      h('td', { class: 'num' }, h('strong', {}, `${n}`)),
      h('td', { class: 'num' }, db.machines[d] ? `${fp.L}×${fp.W}×${fp.H}` : '—'),
      h('td', { class: 'num' }, stackInput(d)),
      h('td', { class: 'num' }, `${fp.tiles}`),
      h('td', {}, ''),
      h('td', {}, ''),
    );
  });

  const totalTiles = zones.reduce((a, z) => a + footprint(app, z.machine!, z.machines).tiles, 0);
  root.replaceChildren(
    h(
      'p',
      { class: 'muted small' },
      'Build each machine type as one area. Size is length × width × height in tiles, from the game data. "Per floor" is how many you stack on one floor (Nursery defaults to 3). Tiles is the floor space the machines themselves need, not counting belts.',
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'lines' },
        h('thead', {}, h('tr', {}, ...['Area', 'Machines', 'Size', 'Per floor', 'Floor tiles', 'Gets', 'Sends'].map(t => h('th', {}, t)))),
        h('tbody', {}, ...rows, ...deviceRows),
      ),
    ),
    h('p', { class: 'muted small' }, `Machine floor space (excluding heating devices and belts): ${totalTiles} tiles.`),
  );
}
