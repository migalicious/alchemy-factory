import './style.css';
import { loadGameData } from './data/adapter';
import { decodePlan, defaultPlan, effectiveChoices, encodePlan, loadLocal, saveLocal, type PlanState } from './state/plan';
import { solvePlan } from './solver/solve';
import { computeHeat } from './solver/heat';
import type { App } from './ui/app';
import { renderSidebar } from './ui/sidebar';
import { renderTable } from './ui/table';
import { renderGraph } from './ui/graph';
import { renderBuild } from './ui/build';
import { renderResearch } from './ui/research';
import { openPicker } from './ui/picker';
import { h, toast } from './ui/dom';
import { rawCoinCost } from './solver/coins';
import { buildOutcome } from './solver/build';

const db = loadGameData();

function initialPlan(): PlanState {
  const hash = location.hash.slice(1);
  if (hash) {
    const p = decodePlan(db, hash);
    if (p) return p;
    toast('Could not read the plan in this link; loaded your last plan instead.');
  }
  return loadLocal(db) ?? defaultPlan();
}

type Tab = 'table' | 'build' | 'graph';
let tab: Tab = 'table';
try {
  const saved = localStorage.getItem('af-planner:tab');
  if (saved === 'graph' || saved === 'build') tab = saved;
} catch {
  /* ignore */
}

const app = {
  db,
  plan: initialPlan(),
  update(mutate?: (p: PlanState) => void) {
    mutate?.(app.plan);
    recompute();
    render();
    saveLocal(app.plan);
    history.replaceState(null, '', `#${encodePlan(app.plan)}`);
  },
  openPicker(item: string) {
    openPicker(app, item);
  },
} as App;

function solveFor(plan: PlanState) {
  const eff = effectiveChoices(db, plan);
  const result = solvePlan(db, { targets: plan.targets, choices: eff.choices, extraRecipes: eff.extraRecipes, settings: plan.settings });
  return { eff, result };
}

const machinesOf = (r: App['result']) => r.lines.reduce((a, l) => a + l.machinesCeil, 0);

function recompute() {
  ({ eff: app.eff, result: app.result } = solveFor(app.plan));
  app.build = undefined;
  if (app.plan.planMode === 'build' && app.result.status === 'optimal') {
    // Aim solve gives each line's machines per unit of target; scale to what the counts reach.
    const outcome = buildOutcome(app.result, app.plan.counts);
    if (outcome) {
      const aimMachines = Object.fromEntries(app.result.lines.map(l => [l.recipe.id, l.machines]));
      const scaled = solvePlan(db, {
        targets: app.plan.targets.map(t => ({ ...t, rate: t.rate * outcome.factor })),
        choices: app.eff.choices,
        extraRecipes: app.eff.extraRecipes,
        settings: app.plan.settings,
      });
      if (scaled.status === 'optimal') {
        // Machines on the floor are the counts you set, whether or not they're all busy.
        for (const l of scaled.lines) l.machinesCeil = outcome.counts[l.recipe.id] ?? l.machinesCeil;
        app.result = scaled;
        app.build = { ...outcome, aimMachines };
      }
    }
  }
  app.heat = computeHeat(db, app.result.lines, app.plan.settings, app.plan.heating);
  app.coinCompare = undefined;
  scheduleCoinCompare();
}

/**
 * "What does the coin weight buy?" needs a second solve with coins ignored. Run it after
 * the page has updated (and only for the latest plan) so edits stay snappy.
 */
let compareTimer: number | undefined;
function scheduleCoinCompare() {
  clearTimeout(compareTimer);
  if (!(app.plan.settings.coinsPerBuilding > 0) || app.result.status !== 'optimal' || app.plan.planMode === 'build') return;
  const plan = app.plan;
  const result = app.result;
  compareTimer = window.setTimeout(() => {
    if (app.plan !== plan || app.result !== result) return;
    const alt = solveFor({ ...plan, settings: { ...plan.settings, coinsPerBuilding: 0 } }).result;
    if (alt.status !== 'optimal') return;
    app.coinCompare = {
      coinsSaved: rawCoinCost(db, alt.raw).total - rawCoinCost(db, result.raw).total,
      extraMachines: machinesOf(result) - machinesOf(alt),
    };
    renderSidebar(app, document.getElementById('sidebar')!);
  }, 50);
}

function render() {
  renderSidebar(app, document.getElementById('sidebar')!);
  renderResearch(app, document.getElementById('research')!);
  renderPlanMode();
  const status = document.getElementById('status')!;
  const notes: string[] = [];
  if (app.result.status !== 'optimal') notes.push(app.result.message ?? '');
  if (app.eff.dropped.length)
    notes.push(`To avoid a loop with your own recipe pick, these went back to their normal recipe instead of the vegan one: ${app.eff.dropped.join(', ')}.`);
  status.hidden = !notes.length;
  status.classList.toggle('info', app.result.status === 'optimal');
  status.textContent = notes.join(' ');
  (document.getElementById('vegan') as HTMLInputElement).checked = app.plan.vegan;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  const views: Record<Tab, (a: App, el: HTMLElement) => void> = { table: renderTable, build: renderBuild, graph: renderGraph };
  for (const t of Object.keys(views) as Tab[]) {
    const el = document.getElementById(`view-${t}`)!;
    el.hidden = t !== tab;
    if (t === tab) views[t](app, el);
  }
}

function renderPlanMode() {
  const el = document.getElementById('plan-mode')!;
  const btn = (mode: PlanState['planMode'], label: string, title: string) =>
    h('button', { type: 'button', class: app.plan.planMode === mode ? 'on' : '', title, onclick: () => app.update(p => (p.planMode = mode)) }, label);
  el.replaceChildren(
    h('span', { class: 'seg-label' }, 'Plan by'),
    btn('rate', 'Rate', 'Size every line for your target rate'),
    btn('build', 'Buildings', 'Start from 1 machine per line, see what it makes and where it chokes, then add machines'),
  );
}

document.getElementById('dbver')!.textContent = `v${db.version}, ${db.date}, game ${db.gameVersion}`;
document.getElementById('vegan')!.addEventListener('change', e => app.update(p => (p.vegan = (e.target as HTMLInputElement).checked)));
document.getElementById('share')!.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#${encodePlan(app.plan)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied');
  } catch {
    prompt('Copy this link:', url);
  }
});
for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab as Tab;
    try {
      localStorage.setItem('af-planner:tab', tab);
    } catch {
      /* ignore */
    }
    render();
  });
}
window.addEventListener('hashchange', () => {
  const p = decodePlan(db, location.hash.slice(1));
  if (p) {
    app.plan = p;
    recompute();
    render();
  }
});

app.update();
