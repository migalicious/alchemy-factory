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
  const rows = orderLines(app).map(line => {
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
    return h(
      'tr',
      { class: veganPick ? 'vegan-row' : '' },
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
      h('td', { class: 'num' }, h('strong', {}, `${line.machinesCeil}`), h('span', { class: 'muted small' }, ` (${fmt(line.machines)})`)),
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
