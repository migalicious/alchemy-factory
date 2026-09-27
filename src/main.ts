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
import { openPicker } from './ui/picker';
import { toast } from './ui/dom';

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

function recompute() {
  app.eff = effectiveChoices(db, app.plan);
  app.result = solvePlan(db, { targets: app.plan.targets, choices: app.eff.choices, extraRecipes: app.eff.extraRecipes, settings: app.plan.settings });
  app.heat = computeHeat(db, app.result.lines, app.plan.settings, app.plan.heating);
}

function render() {
  renderSidebar(app, document.getElementById('sidebar')!);
  const status = document.getElementById('status')!;
  status.hidden = app.result.status === 'optimal';
  status.textContent = app.result.message ?? '';
  (document.getElementById('vegan') as HTMLInputElement).checked = app.plan.vegan;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  const views: Record<Tab, (a: App, el: HTMLElement) => void> = { table: renderTable, build: renderBuild, graph: renderGraph };
  for (const t of Object.keys(views) as Tab[]) {
    const el = document.getElementById(`view-${t}`)!;
    el.hidden = t !== tab;
    if (t === tab) views[t](app, el);
  }
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
