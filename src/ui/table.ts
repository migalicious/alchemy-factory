import type { App } from './app';
import { fmt, h } from './dom';
import { isHeated, recipeLabel } from './describe';
import type { HeatingDevice } from '../model/types';
import type { Line } from '../solver/solve';

const DEVICES: HeatingDevice[] = ['Steam Heating Pad', 'Stone Furnace', 'Blast Furnace'];

/** Order lines so targets come first and inputs follow their consumers (reverse topological). */
export function orderLines(app: App): Line[] {
  const { result, plan } = app;
  const byItem = new Map<string, Line>();
  for (const l of result.lines) for (const i of l.items) byItem.set(i, l);
  const seen = new Set<string>();
  const out: Line[] = [];
  const visit = (item: string) => {
    const l = byItem.get(item);
    if (!l || seen.has(l.recipe.id)) return;
    seen.add(l.recipe.id);
    out.push(l);
    for (const i of Object.keys(l.inputs)) visit(i);
  };
  for (const t of plan.targets) visit(t.item);
  for (const l of result.lines) if (!seen.has(l.recipe.id)) out.push(l);
  return out;
}

export function renderTable(app: App, root: HTMLElement): void {
  const { db, heat, plan, result, eff } = app;
  if (!result.lines.length) {
    root.replaceChildren(h('p', { class: 'muted pad' }, 'Add a target to get started.'));
    return;
  }
  const veganPicks = eff.vegan?.choices ?? {};
  let ordered = orderLines(app);
  if (app.build && busiestFirst) ordered = [...ordered].sort((a, b) => (app.build!.util[b.recipe.id] ?? 0) - (app.build!.util[a.recipe.id] ?? 0));
  const rows = ordered.map(line => {
    const primary = line.items[0] ?? Object.keys(line.outputs)[0];
    const lh = heat.lines.get(line.recipe.id);
    const userPick = line.items.some(i => plan.choices[i]);
    const veganPick = !userPick && line.items.some(i => veganPicks[i] === line.recipe.id);
    const outs = Object.entries(line.outputs)
      .map(([k, v]) => `${fmt(v)} ${k}`)
      .join(', ');
    const ins = Object.entries(line.inputs).map(([k, v]) =>
      h('button', { class: 'chip', onclick: () => app.openPicker(k), title: `Choose recipe for ${k}` }, `${fmt(v)} ${k}`),
    );
    const heating = lh
      ? h(
          'select',
          {
            class: 'heat-select',
            'aria-label': 'Heating device',
            onchange: (e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              app.update(p => {
                if (v === '') delete p.heating[line.recipe.id];
                else p.heating[line.recipe.id] = v as HeatingDevice;
              });
            },
          },
          h('option', { value: '', selected: !plan.heating[line.recipe.id] }, `Default (${short(plan.settings.heating)})`),
          ...DEVICES.map(d => h('option', { value: d, selected: plan.heating[line.recipe.id] === d }, short(d))),
        )
      : isHeated(db, line.recipe)
        ? '—'
        : '';
    const heatCell = lh
      ? h(
          'div',
          { class: 'heat' },
          h('div', {}, `${fmt(lh.heatPerSec)} P/s`),
          h(
            'div',
            { class: 'muted small' },
            lh.device === 'Steam Heating Pad' ? `${fmt(lh.steamPerMin)} steam/min · ${lh.devices} pad${lh.devices === 1 ? '' : 's'}` : `${fmt(lh.fuelPerMin)} ${plan.settings.fuel}/min · ${lh.devices} furnace${lh.devices === 1 ? '' : 's'}`,
            lh.slotsAssumed ? h('span', { title: 'Slot size not in the DB; assumed 1 slot per machine' }, ' ?') : null,
          ),
        )
      : '';
    const util = app.build?.util[line.recipe.id];
    const rowClass = [veganPick ? 'vegan-row' : '', util === undefined ? '' : util > 1 - 1e-6 ? 'choke' : util >= 0.8 ? 'tight' : ''].join(' ').trim();
    return h(
      'tr',
      { class: rowClass },
      h('td', {}, h('button', { class: 'item-btn', onclick: () => app.openPicker(primary) }, line.items.join(' + ') || primary)),
      h(
        'td',
        {},
        h('button', { class: 'recipe-btn', onclick: () => app.openPicker(primary), title: 'Change recipe' }, recipeLabel(line.recipe), ' ✎'),
        userPick ? h('span', { class: 'badge', title: 'Your pick' }, '★') : null,
        veganPick ? h('span', { class: 'badge ok', title: 'Vegan pick' }, '🌿') : null,
        eff.vegan && line.items.some(i => eff.vegan!.exclude.has(i))
          ? h('span', { class: 'badge warn', title: 'You asked to avoid this, but nothing else can make what this chain needs. Pick another recipe for the item that consumes it.' }, '⚠ avoided')
          : eff.vegan && !line.items.some(i => eff.vegan!.vegan.has(i))
            ? h('span', { class: 'badge warn', title: "Can't be made from your ticked sources, so it uses its normal recipe" }, '⚠ outside sources')
            : null,
      ),
      app.build ? countCell(app, line.recipe.id, util ?? 0) : h('td', { class: 'num' }, h('strong', {}, `${line.machinesCeil}`), h('span', { class: 'muted small' }, ` (${fmt(line.machines)})`)),
      h('td', {}, outs),
      h('td', { class: 'chips' }, ...ins),
      h('td', {}, heating),
      h('td', {}, heatCell),
    );
  });

  const b = heat.boiler;
  if (b) {
    rows.push(
      h(
        'tr',
        { class: 'boiler-row' },
        h('td', {}, '♨️ Boiler bank'),
        h('td', {}, `Steam Boiler on ${b.furnace}`),
        h('td', { class: 'num' }, h('strong', {}, `${b.boilersCeil}`), h('span', { class: 'muted small' }, ` (${fmt(b.boilers)})`)),
        h('td', {}, `${fmt(b.steamPerMin)} Steam`),
        h('td', {}, `${fmt(b.fuelPerMin)} ${plan.settings.fuel}`),
        h('td', {}, `${b.furnaces} ${short(b.furnace)}`),
        h('td', {}, `${fmt(b.heatPerSec)} P/s`),
      ),
    );
  }

  root.replaceChildren(
    app.build ? buildBanner(app) : '',
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'lines' },
        h(
          'thead',
          {},
          h('tr', {}, ...['Item', 'Recipe', 'Machines', 'Output /min', 'Inputs /min', 'Heating', 'Heat'].map(t => h('th', {}, t))),
        ),
        h('tbody', {}, ...rows),
      ),
    ),
  );
}

export const short = (d: string) => (d === 'Steam Heating Pad' ? 'Steam pad' : d);

/** Build mode: − count + with a usage bar (red = the choke point, orange = close behind). */
function countCell(app: App, recipeId: string, util: number): HTMLElement {
  const count = app.build!.counts[recipeId] ?? 1;
  const set = (n: number) =>
    app.update(p => {
      if (n <= 1) delete p.counts[recipeId];
      else p.counts[recipeId] = n;
    });
  const pct = Math.min(100, util * 100);
  return h(
    'td',
    { class: 'num count-cell' },
    h(
      'div',
      { class: 'stepper' },
      h('button', { class: 'icon', title: 'One fewer', disabled: count <= 1, onclick: () => set(count - 1) }, '−'),
      h('input', {
        type: 'number',
        min: 1,
        value: count,
        'aria-label': 'Machines on this line',
        onchange: (e: Event) => set(Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value) || 1))),
      }),
      h('button', { class: 'icon', title: 'One more', onclick: () => set(count + 1) }, '+'),
    ),
    h('div', { class: 'util', title: `${fmt(pct, 1)}% busy` }, h('div', { class: 'util-fill', style: `width:${pct}%` })),
    h('div', { class: 'muted small' }, `${fmt(pct, 0)}% busy`),
  );
}

/** Build mode summary: what the current machines make, the choke point, and the next step. */
function buildBanner(app: App): HTMLElement {
  const b = app.build!;
  const { plan, result } = app;
  const targets = plan.targets.filter(t => t.rate > 0);
  const total = Object.values(b.counts).reduce((a, n) => a + n, 0);
  const lineName = (id: string) => {
    const l = result.lines.find(x => x.recipe.id === id);
    return l ? `${l.items.join(' + ') || id} (${l.recipe.machine})` : id;
  };
  const makes = (f: number) => targets.map(t => `${fmt(t.rate * f, 3)}/min ${t.item}`).join(', ');
  return h(
    'div',
    { class: 'panel build-banner' },
    h('div', {}, `${total} machines make `, h('strong', {}, makes(b.factor)), targets.length ? ` (${fmt(b.factor * 100, 1)}% of your aim)` : ''),
    b.bottlenecks.length
      ? h('div', {}, h('span', { class: 'badge warn' }, 'choke point'), ' ', b.bottlenecks.map(lineName).join(', '))
      : null,
    b.next
      ? h(
          'div',
          {},
          `+1 ${b.next.add.length > 1 ? 'each on those lines' : 'there'} → ${makes(b.next.factor)} `,
          h(
            'button',
            {
              onclick: () =>
                app.update(p => {
                  for (const id of b.next!.add) p.counts[id] = (b.counts[id] ?? 1) + 1;
                }),
            },
            `Add ${b.next.add.length > 1 ? `${b.next.add.length} machines` : 'it'}`,
          ),
          ' ',
          h('button', { class: 'link small', onclick: () => app.update(p => (p.counts = {})) }, 'Reset to 1 each'),
        )
      : null,
    h(
      'label',
      { class: 'toggle small' },
      h('input', {
        type: 'checkbox',
        checked: busiestFirst,
        onchange: (e: Event) => {
          busiestFirst = (e.target as HTMLInputElement).checked;
          try {
            localStorage.setItem('af-planner:busiest-first', busiestFirst ? '1' : '');
          } catch {
            /* ignore */
          }
          app.update();
        },
      }),
      h('span', {}, 'Busiest lines first'),
    ),
  );
}

let busiestFirst = false;
try {
  busiestFirst = localStorage.getItem('af-planner:busiest-first') === '1';
} catch {
  /* ignore */
}
