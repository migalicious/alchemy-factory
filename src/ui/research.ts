import type { App } from './app';
import { h } from './dom';
import type { Settings } from '../model/settings';

type Key = keyof Settings['upgrades'];
const FIELDS: [Key, string, string][] = [
  ['logistics', 'Logistics', 'Belt speed'],
  ['factory', 'Factory', 'Factory Efficiency: machine speed'],
  ['alchemy', 'Alchemy', 'Alchemy Skill: Extractor / Alembic yield'],
  ['fuel', 'Fuel', 'Fuel Efficiency: heat per fuel item'],
  ['fert', 'Fertilizer', 'Fertilizer Efficiency: nutrients per fertilizer item'],
];

/** Research levels in the top bar. */
export function renderResearch(app: App, root: HTMLElement): void {
  const u = app.plan.settings.upgrades;
  root.replaceChildren(
    h('span', { class: 'research-label' }, 'Research'),
    ...FIELDS.map(([key, label, title]) =>
      h(
        'label',
        { title },
        h('span', {}, label),
        h('input', {
          type: 'number',
          min: 0,
          max: 30,
          value: u[key],
          onchange: (e: Event) => app.update(p => (p.settings.upgrades[key] = Math.min(30, Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0))))),
        }),
      ),
    ),
  );
}
