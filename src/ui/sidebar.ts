import type { App } from './app';
import { fmt, h } from './dom';
import type { HeatingDevice } from '../model/types';
import { STEAM_BOILER_SLOTS } from '../data/overrides';
import { boughtSources, grownSources } from '../cauldron/pool';
import { DEFAULT_VEGAN_EXCLUDE } from '../state/plan';
import { fmtCoins, rawCoinCost } from '../solver/coins';

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
    select(
      'Steam from',
      plan.settings.steamSupply,
      [
        ['existing', 'My existing supply'],
        ['boilers', 'Plan boilers'],
      ],
      v => app.update(p => (p.settings.steamSupply = v as 'existing' | 'boilers')),
    ),
    select('Furnace (fuel lines & boilers)', plan.settings.furnace, [['Stone Furnace', 'Stone Furnace'], ['Blast Furnace', 'Blast Furnace']], v =>
      app.update(p => (p.settings.furnace = v as 'Stone Furnace' | 'Blast Furnace')),
    ),
    select('Fuel', plan.settings.fuel, fuels, v => app.update(p => (p.settings.fuel = v))),
    h(
      'label',
      {
        class: 'field',
        title:
          'How much buying raws should count against building more. 1000 = saving 1,000 coins/min is worth one extra building. Lower it to avoid pricey raws (Rock Salt, Quartz…) harder; 0 ignores coins.',
      },
      h('span', { title: '🥉 copper · 🥈 silver (1,000 🥉) · 🥇 gold (100 🥈)' }, '1 building ≈ 🥉 copper/min'),
      h('input', {
        type: 'number',
        min: 0,
        step: 500,
        value: plan.settings.coinsPerBuilding,
        onchange: (e: Event) => app.update(p => (p.settings.coinsPerBuilding = Math.max(0, Number((e.target as HTMLInputElement).value) || 0))),
      }),
    ),
    select('Fertilizer (Nursery)', plan.settings.fertilizer, ferts, v => app.update(p => (p.settings.fertilizer = v))),
    h(
      'label',
      { class: 'toggle', title: 'Use the Enhanced Grinder (2× speed, same ingredients) wherever a Grinder recipe has one' },
      h('input', {
        type: 'checkbox',
        checked: plan.settings.preferMachines.includes('Enhanced Grinder'),
        onchange: (e: Event) =>
          app.update(p => {
            const on = (e.target as HTMLInputElement).checked;
            p.settings.preferMachines = p.settings.preferMachines.filter(m => m !== 'Enhanced Grinder');
            if (on) p.settings.preferMachines.push('Enhanced Grinder');
          }),
      }),
      h('span', {}, 'Prefer Enhanced Grinder'),
    ),
    h(
      'label',
      { class: 'toggle', title: 'Seed Plots are harvested by hand (no belts), so never plan them; herbs come from Nurseries' },
      h('input', {
        type: 'checkbox',
        checked: plan.settings.avoidMachines.includes('Seed Plot'),
        onchange: (e: Event) =>
          app.update(p => {
            const on = (e.target as HTMLInputElement).checked;
            p.settings.avoidMachines = p.settings.avoidMachines.filter(m => m !== 'Seed Plot');
            if (on) p.settings.avoidMachines.push('Seed Plot');
          }),
      }),
      h('span', {}, 'Never use Seed Plots'),
    ),
  );

  const vegan = plan.vegan ? renderVeganPanel(app) : null;

  root.replaceChildren(
    datalist,
    h('section', { class: 'panel' }, h('h2', {}, 'Targets'), targets),
    vegan ?? '',
    settings,
    renderSummary(app),
  );
}

function renderSummary(app: App): HTMLElement {
  const { db, result, heat, plan, eff } = app;
  const fuel = plan.settings.fuel;
  const machineCounts = new Map<string, number>();
  for (const l of result.lines) machineCounts.set(l.recipe.machine, (machineCounts.get(l.recipe.machine) ?? 0) + l.machinesCeil);
  for (const [d, n] of Object.entries(heat.devices)) if (n) machineCounts.set(d, (machineCounts.get(d) ?? 0) + n);

  const allowed = eff.vegan?.allowedRaws;
  const coins = rawCoinCost(db, result.raw);
  // Most expensive first, so pricey ores (Quartz…) stand out.
  const rawRows = Object.entries(result.raw)
    .sort((a, b) => (coins.perItem[b[0]] ?? -1) - (coins.perItem[a[0]] ?? -1) || b[1] - a[1])
    .map(([item, rate]) => {
      const c = coins.perItem[item];
      const badge = allowed && !allowed.has(item) ? h('span', { class: 'badge warn', title: "Not in your vegan sources, but nothing else can make what's needed" }, '⚠ not allowed') : null;
      return h(
        'li',
        {},
        h('button', { class: 'link', onclick: () => app.openPicker(item), title: 'Choose a recipe for this item' }, item),
        badge,
        h('span', { class: 'num' }, `${fmt(rate)}/min`),
        h('span', { class: 'num coins', title: c === null ? "Can't be bought: make it or supply it yourself" : `${fmt(rate)} × ${fmtCoins(c / rate)} each` }, c === null ? '—' : `${fmtCoins(c)}/min`),
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
      h('dt', {}, 'Coins'),
      h(
        'dd',
        { title: 'Buying raw inputs from Purchasing Portals (rate × buy price)' },
        `${fmtCoins(coins.total)}/min`,
        app.coinCompare && app.coinCompare.coinsSaved > 1
          ? h(
              'div',
              { class: 'muted small', title: 'Compared with the same plan when coins are ignored (1 building ≈ 0)' },
              `Coin weight saves ${fmtCoins(app.coinCompare.coinsSaved)}/min for ${app.coinCompare.extraMachines > 0 ? `+${app.coinCompare.extraMachines}` : app.coinCompare.extraMachines} building${Math.abs(app.coinCompare.extraMachines) === 1 ? '' : 's'}`,
            )
          : null,
      ),
      h('dt', {}, 'Fuel'),
      h('dd', {}, `${fmt(heat.totalFuelPerMin)} ${fuel}/min`),
      heat.steamPerMin > 0 ? h('dt', {}, 'Steam') : null,
      heat.steamPerMin > 0 ? h('dd', {}, `${fmt(heat.steamPerMin)}/min${b ? '' : ' from your existing supply'}`) : null,
      h('dt', {}, 'Heat'),
      h('dd', {}, `${fmt(heat.totalHeatPerSec)} P/s`),
      b ? h('dt', {}, 'Boiler bank') : null,
      b
        ? h(
            'dd',
            {},
            `${b.boilersCeil} Steam Boiler${b.boilersCeil === 1 ? '' : 's'} (${fmt(b.boilers)}) on ${b.furnaces} ${b.furnace}${b.furnaces === 1 ? '' : 's'} · ${fmt(b.steamPerMin)} steam/min · ${fmt(b.fuelPerMin)} ${fuel}/min`,
            h('span', { class: 'muted small' }, ` (a boiler takes ${STEAM_BOILER_SLOTS} furnace slots: 1 per Stone Furnace, 4 per Blast Furnace)`),
          )
        : null,
      result.fertPerMin > 0 ? h('dt', {}, 'Fertilizer') : null,
      result.fertPerMin > 0 ? h('dd', {}, `${fmt(result.fertPerMin)} ${plan.settings.fertilizer}/min`) : null,
    ),
    h('h3', {}, 'Raw inputs (per min)'),
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

function renderVeganPanel(app: App): HTMLElement {
  const { db, plan, eff } = app;
  const grown = grownSources(db);
  const bought = boughtSources(db).sort((a, b) => (db.items[a].buyPrice ?? 0) - (db.items[b].buyPrice ?? 0));
  const sources = [...grown, ...bought];
  const price = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : `${n}`);
  const checks = (items: string[], label: (i: string) => string) =>
    h(
      'div',
      { class: 'checks' },
      ...items.map(src =>
        h(
          'label',
          { class: 'toggle' },
          h('input', { type: 'checkbox', checked: !excluded.has(src), onchange: (e: Event) => toggle(src, (e.target as HTMLInputElement).checked) }),
          h('span', {}, label(src)),
        ),
      ),
    );
  const excluded = new Set(plan.veganExclude);
  const toggle = (item: string, on: boolean) =>
    app.update(p => {
      p.veganExclude = p.veganExclude.filter(i => i !== item);
      if (!on) p.veganExclude.push(item);
    });
  const avoided = plan.veganExclude.filter(i => !sources.includes(i));
  const avoidInput = h('input', { list: 'items-list', placeholder: 'Avoid an item, e.g. Perfect Diamond', 'aria-label': 'Item to avoid' });
  const addAvoid = () => {
    const v = avoidInput.value.trim();
    if (db.items[v] && !excluded.has(v)) app.update(p => p.veganExclude.push(v));
  };
  avoidInput.addEventListener('change', addAvoid);
  const reached = eff.vegan?.vegan.size ?? 0;
  return h(
    'div',
    { class: 'panel vegan-panel' },
    h('strong', {}, '🌿 Vegan mode on'),
    h('p', { class: 'muted' }, `Recipes are auto-picked to use only the sources you tick below, through normal recipes and cauldron combos. Your own picks still win. ${reached} items reachable.`),
    h(
      'label',
      { class: 'field', title: 'When several plant-based recipes exist, which one to use' },
      h('span', {}, 'Pick recipes for'),
      h(
        'select',
        { onchange: (e: Event) => app.update(p => (p.veganGoal = (e.target as HTMLSelectElement).value as 'buildings' | 'coins')) },
        h('option', { value: 'buildings', selected: plan.veganGoal === 'buildings' }, 'Fewest buildings'),
        h('option', { value: 'coins', selected: plan.veganGoal === 'coins' }, 'Cheapest (coins)'),
      ),
    ),
    h('h3', {}, 'Grown (Nursery)'),
    checks(grown, i => i),
    h('h3', {}, 'Bought (Purchasing Portal)'),
    checks(bought, i => `${i} · ${price(db.items[i].buyPrice ?? 0)}`),
    h(
      'label',
      { class: 'field', title: 'How many processing steps from a source still count as a cauldron ingredient. Iron Ore → Iron Ingot → Iron Sand and Logs → Plank → Large Wooden Gear are 2 steps.' },
      h('span', {}, 'Cauldron ingredients: steps from sources'),
      h('input', {
        type: 'number',
        min: 0,
        max: 4,
        value: plan.veganDepth,
        onchange: (e: Event) => app.update(p => (p.veganDepth = Math.min(4, Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0))))),
      }),
    ),
    h(
      'label',
      { class: 'toggle', title: 'Off: cauldrons and the Paradox Crucible only get broken-down items (Iron Ingot, Plank, Salt…), never a whole bought unit of ore or logs' },
      h('input', { type: 'checkbox', checked: plan.veganRawInCauldron, onchange: (e: Event) => app.update(p => (p.veganRawInCauldron = (e.target as HTMLInputElement).checked)) }),
      h('span', {}, 'Allow bought raws straight into cauldrons / Paradox Crucible'),
    ),
    h('h3', {}, 'Avoid'),
    h(
      'div',
      { class: 'chips' },
      ...avoided.map(i => h('button', { class: 'chip', title: 'Stop avoiding', onclick: () => toggle(i, true) }, `${i} ✕`)),
    ),
    h('div', { class: 'avoid-row' }, avoidInput, h('button', { onclick: addAvoid }, 'Add')),
    h(
      'button',
      { class: 'link small', onclick: () => app.update(p => (p.veganExclude = [...DEFAULT_VEGAN_EXCLUDE])) },
      'Reset to defaults',
    ),
  );
}
