import type { App } from './app';
import { fmt, h } from './dom';
import { recipeLabel, recipeSummary } from './describe';
import { cauldronRecipe } from '../cauldron/engine';
import { allPool, herbPool } from '../cauldron/pool';
import { findCombos, type Combo } from '../cauldron/search';
import { chosenRecipe, producibleRecipes, recipeLookup, RAW } from '../solver/solve';
import type { GameData } from '../model/types';

type PoolKind = 'herb' | 'all';
const comboCache = new Map<PoolKind, Map<string, Combo[]>>();
let poolKind: PoolKind = 'herb';

function combos(db: GameData, kind: PoolKind): Map<string, Combo[]> {
  let c = comboCache.get(kind);
  if (!c) comboCache.set(kind, (c = findCombos(db, kind === 'herb' ? herbPool(db) : allPool(db))));
  return c;
}

export function openPicker(app: App, item: string): void {
  const dlg = document.getElementById('picker') as HTMLDialogElement;
  const render = () => {
    const { db, plan, eff } = app;
    const lookup = recipeLookup(db, eff.extraRecipes, plan.settings.preferMachines);
    const current = eff.choices[item] === RAW ? RAW : chosenRecipe(lookup, eff.choices, item)?.id;
    const userPick = plan.choices[item];
    const choose = (id: string | null) => {
      app.update(p => {
        if (id === null) delete p.choices[item];
        else p.choices[item] = id;
      });
      render();
    };

    const recipes = producibleRecipes(lookup, item).filter(r => !r.generated);
    const recipeButtons = recipes.map((r, i) =>
      h(
        'button',
        { class: `option ${current === r.id ? 'selected' : ''}`, onclick: () => choose(r.id) },
        h('div', { class: 'option-title' }, recipeLabel(r), i === 0 ? h('span', { class: 'badge' }, 'default') : null, r.outputs[item] !== undefined && Object.keys(r.outputs)[0] !== item ? h('span', { class: 'badge warn' }, 'byproduct') : null),
        h('div', { class: 'muted small' }, recipeSummary(r)),
      ),
    );

    const comboBox = h('div', { class: 'combos' }, h('p', { class: 'muted' }, 'Searching…'));
    const fillCombos = () => {
      const list = (combos(db, poolKind).get(item) ?? []).slice(0, 15);
      comboBox.replaceChildren(
        ...(list.length
          ? list.map(c => {
              const r = cauldronRecipe(db, c.type, c.inputs, item);
              return h(
                'button',
                { class: `option ${current === r.id ? 'selected' : ''}`, onclick: () => choose(r.id) },
                h('div', { class: 'option-title' }, `${c.type}: ${c.inputs.join(' + ')}`),
                h('div', { class: 'muted small' }, `${fmt(r.baseTime ?? 0)} s · ${fmt(r.heatCost ?? 0)} P/s · est. cost ${c.cost === null ? '?' : fmt(c.cost)}`),
              );
            })
          : [h('p', { class: 'muted' }, poolKind === 'herb' ? 'No single-step herb combo makes this. Try "All items", or turn on 🌿 Vegan for multi-step chains.' : 'No cauldron combo makes this item.')]),
      );
    };
    // Defer so the dialog paints before a (possibly ~0.5 s) search.
    setTimeout(fillCombos, 0);

    const isCandidateTarget = db.items[item]?.cauldronTarget !== undefined;
    dlg.replaceChildren(
      h(
        'form',
        { method: 'dialog', class: 'picker-inner' },
        h('header', {}, h('h2', {}, item), h('button', { class: 'icon', value: 'close', 'aria-label': 'Close' }, '✕')),
        h(
          'div',
          { class: 'picker-actions' },
          h('button', { type: 'button', class: `option small ${current === RAW ? 'selected' : ''}`, onclick: () => choose(RAW) }, '📦 Treat as raw input (don\'t build it)'),
          userPick ? h('button', { type: 'button', class: 'option small', onclick: () => choose(null) }, plan.vegan ? '↺ Reset to vegan/default pick' : '↺ Reset to default') : null,
        ),
        h('h3', {}, 'Recipes'),
        recipeButtons.length ? h('div', { class: 'options' }, ...recipeButtons) : h('p', { class: 'muted' }, 'Only obtainable by buying it.'),
        isCandidateTarget
          ? h(
              'div',
              {},
              h(
                'div',
                { class: 'combo-head' },
                h('h3', {}, 'Cauldron combos'),
                h(
                  'div',
                  { class: 'seg' },
                  h('button', { type: 'button', class: poolKind === 'herb' ? 'on' : '', onclick: () => ((poolKind = 'herb'), render()) }, '🌿 Herb pool'),
                  h('button', { type: 'button', class: poolKind === 'all' ? 'on' : '', onclick: () => ((poolKind = 'all'), render()) }, 'All items'),
                ),
              ),
              h('p', { class: 'muted small' }, 'Any 3 ingredients (Cauldron) or 2 (Advanced Cauldron) whose combined cauldron value lands nearest this item. Sorted by estimated cost.'),
              comboBox,
            )
          : null,
      ),
    );
  };
  render();
  if (!dlg.open) dlg.showModal();
}
