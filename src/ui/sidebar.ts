import type { App } from './app';
import { fmt, h } from './dom';
import type { HeatingDevice } from '../model/types';
import { STEAM_BOILER_SLOTS } from '../data/overrides';

const DEVICES: HeatingDevice[] = ['Steam Heating Pad', 'Stone Furnace', 'Blast Furnace'];

export function renderSidebar(app: App, root: HTMLElement): void {
  const { db, plan } = app;
  const producible = Object.keys(db.items)
    .filter(i => db.recipesByOutput.has(i))
    .sort((a, b) => a.localeCompare(b));

  const datalist = h('datalist', { id: 'items-list' }, ...producible.map(i => h('option', { value: i })));

  const targets = h(
    'div',
    { class: 'targets' },
    ...plan.targets.map((t, idx) =>
      h(
        'div',
        { class: 'target-row' },
        h('input', {
          class: 'target-item',
          list: 'items-list',
          value: t.item,
          'aria-label': 'Target item',
          onchange: (e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            if (db.items[v]) app.update(p => (p.targets[idx].item = v));
          },
        }),
        h('input', {
          class: 'target-rate',
          type: 'number',
          min: 0,
          step: 'any',
          value: t.rate,
          'aria-label': 'Items per minute',
          onchange: (e: Event) => app.update(p => (p.targets[idx].rate = Math.max(0, Number((e.target as HTMLInputElement).value) || 0))),
        }),
        h('span', { class: 'unit' }, '/min'),
        h('button', { class: 'icon', title: 'Remove', onclick: () => app.update(p => p.targets.splice(idx, 1)) }, '✕'),
      ),
    ),
    h('button', { class: 'add', onclick: () => app.update(p => p.targets.push({ item: 'Plank', rate: 10 })) }, '+ Add target'),
  );

  const num = (label: string, key: keyof typeof plan.settings.upgrades) =>
    h(
      'label',
      { class: 'field' },
      h('span', {}, label),
      h('input', {
        type: 'number',
        min: 0,
        max: 30,
        value: plan.settings.upgrades[key],
        onchange: (e: Event) => app.update(p => (p.settings.upgrades[key] = Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)))),
      }),
    );

  const select = (label: string, value: string, options: [string, string][], onchange: (v: string) => void) =>
    h(
      'label',
      { class: 'field' },
      h('span', {}, label),
      h(
        'select',
        { onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
        ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)),
      ),
    );

  const fuels = Object.entries(db.items)
    .filter(([, it]) => it.heat)
    .sort((a, b) => a[1].heat! - b[1].heat!)
    .map(([n, it]) => [n, `${n} (${fmt(it.heat!)} P)`] as [string, string]);
  const ferts = Object.entries(db.items)
    .filter(([, it]) => it.nutrientValue)
    .map(([n, it]) => [n, `${n} (${fmt(it.nutrientValue!)} V)`] as [string, string]);

  const settings = h(
    'details',
    { class: 'panel', open: true },
    h('summary', {}, 'Heating & fuel'),
    select('Default heating', plan.settings.heating, DEVICES.map(d => [d, d]), v => app.update(p => (p.settings.heating = v as HeatingDevice))),
    select('Furnace (fuel lines & boilers)', plan.settings.furnace, [['Stone Furnace', 'Stone Furnace'], ['Blast Furnace', 'Blast Furnace']], v =>
      app.update(p => (p.settings.furnace = v as 'Stone Furnace' | 'Blast Furnace')),
    ),
    select('Fuel', plan.settings.fuel, fuels, v => app.update(p => (p.settings.fuel = v))),
    select('Fertilizer (Nursery)', plan.settings.fertilizer, ferts, v => app.update(p => (p.settings.fertilizer = v))),
  );

  const upgrades = h(
    'details',
    { class: 'panel' },
    h('summary', {}, 'Research levels'),
    num('Logistics (belt speed)', 'logistics'),
    num('Factory Efficiency', 'factory'),
    num('Alchemy Skill', 'alchemy'),
    num('Fuel Efficiency', 'fuel'),
    num('Fertilizer Efficiency', 'fert'),
  );

  const vegan = plan.vegan
    ? h(
        'div',
        { class: 'panel vegan-panel' },
        h('strong', {}, '🌿 Vegan mode on'),
        h('p', { class: 'muted' }, 'Recipes are auto-picked so items come from plants, using normal recipes and cauldron combos. Your own picks still win.'),
        h(
          'label',
          { class: 'toggle' },
          h('input', { type: 'checkbox', checked: plan.veganLogs, onchange: (e: Event) => app.update(p => (p.veganLogs = (e.target as HTMLInputElement).checked)) }),
          h('span', {}, 'Count logs (trees) as plants'),
        ),
      )
    : null;

  root.replaceChildren(
    datalist,
    h('section', { class: 'panel' }, h('h2', {}, 'Targets'), targets),
    vegan ?? '',
    settings,
    upgrades,
    renderSummary(app),
  );
}

function renderSummary(app: App): HTMLElement {
  const { db, result, heat, plan, eff } = app;
  const fuel = plan.settings.fuel;
  const machineCounts = new Map<string, number>();
  for (const l of result.lines) machineCounts.set(l.recipe.machine, (machineCounts.get(l.recipe.machine) ?? 0) + l.machinesCeil);
  for (const [d, n] of Object.entries(heat.devices)) if (n) machineCounts.set(d, (machineCounts.get(d) ?? 0) + n);

  const plantRaws = eff.vegan?.plantRaws;
  const rawRows = Object.entries(result.raw)
    .sort((a, b) => b[1] - a[1])
    .map(([item, rate]) => {
      const badge = plantRaws ? (plantRaws.has(item) ? h('span', { class: 'badge ok', title: 'Plant source' }, '🌿') : h('span', { class: 'badge warn', title: 'Not from plants' }, '⛏')) : null;
      return h(
        'li',
        {},
        h('button', { class: 'link', onclick: () => app.openPicker(item), title: 'Choose a recipe for this item' }, item),
        badge,
        h('span', { class: 'num' }, `${fmt(rate)}/min`),
      );
    });

  const b = heat.boiler;
  return h(
    'section',
    { class: 'panel summary' },
    h('h2', {}, 'Totals'),
    h(
      'dl',
      {},
      h('dt', {}, 'Fuel'),
      h('dd', {}, `${fmt(heat.totalFuelPerMin)} ${fuel}/min`),
      h('dt', {}, 'Heat'),
      h('dd', {}, `${fmt(heat.totalHeatPerSec)} P/s`),
      b ? h('dt', {}, 'Boiler bank') : null,
      b
        ? h(
            'dd',
            {},
            `${b.boilersCeil} Steam Boiler${b.boilersCeil === 1 ? '' : 's'} (${fmt(b.boilers)}) on ${b.furnaces} ${b.furnace}${b.furnaces === 1 ? '' : 's'} · ${fmt(b.steamPerMin)} steam/min · ${fmt(b.fuelPerMin)} ${fuel}/min`,
            h('span', { class: 'muted small', title: 'The DB has no slot size for Steam Boiler; please confirm in-game' }, ` (assumes ${STEAM_BOILER_SLOTS} furnace slots per boiler — unverified)`),
          )
        : null,
      result.fertPerMin > 0 ? h('dt', {}, 'Fertilizer') : null,
      result.fertPerMin > 0 ? h('dd', {}, `${fmt(result.fertPerMin)} ${plan.settings.fertilizer}/min`) : null,
    ),
    h('h3', {}, 'Raw inputs'),
    rawRows.length ? h('ul', { class: 'kv' }, ...rawRows) : h('p', { class: 'muted' }, 'None'),
    Object.keys(result.surplus).length ? h('h3', {}, 'Surplus / byproducts') : null,
    Object.keys(result.surplus).length
      ? h('ul', { class: 'kv' }, ...Object.entries(result.surplus).map(([i, r]) => h('li', {}, h('span', {}, i), h('span', { class: 'num' }, `${fmt(r)}/min`))))
      : null,
    h('h3', {}, 'Buildings'),
    h(
      'ul',
      { class: 'kv' },
      ...[...machineCounts]
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => h('li', {}, h('span', {}, m), h('span', { class: 'num' }, `× ${n}`))),
    ),
    h('p', { class: 'muted small' }, `${db.recipes.length} recipes · game ${db.gameVersion}`),
  );
}
