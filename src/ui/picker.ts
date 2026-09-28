import type { App } from './app';
import { fmt, h } from './dom';
import { recipeLabel, recipeSummary } from './describe';
import { cauldronRecipe } from '../cauldron/engine';
import { allPool, sourcePool } from '../cauldron/pool';
import { findCombos, findCombosWith, type Combo } from '../cauldron/search';
import { chosenRecipe, producibleRecipes, recipeLookup, RAW } from '../solver/solve';

type PoolKind = 'herb' | 'all';
const comboCache = new Map<string, Map<string, Combo[]>>();
let poolKind: PoolKind = 'herb';

/** Combos from the plant pool (per the plan's vegan settings) or from every item. */
function combos(app: App, kind: PoolKind): Map<string, Combo[]> {
  const { db, plan } = app;
  const key = kind === 'all' ? 'all' : JSON.stringify([[...plan.veganExclude].sort(), plan.veganDepth, plan.veganRawInCauldron]);
  let c = comboCache.get(key);
  if (!c) {
    if (comboCache.size > 10) comboCache.clear();
    const pool = kind === 'all' ? allPool(db) : sourcePool(db, { exclude: plan.veganExclude, depth: plan.veganDepth, rawInCauldron: plan.veganRawInCauldron });
    comboCache.set(key, (c = findCombos(db, pool)));
  }
  return c;
}

export function openPicker(app: App, item: string): void {
  const dlg = document.getElementById('picker') as HTMLDialogElement;
  let ingredient = ''; // "with ingredient" filter, kept while this picker is open
  const render = () => {
    const { db, plan, eff } = app;
    const lookup = recipeLookup(db, eff.extraRecipes, plan.settings.preferMachines, plan.settings.avoidMachines);
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
    const ingredientInput = h('input', {
      type: 'search',
      list: 'items-list',
      value: ingredient,
      placeholder: 'With ingredient, e.g. Redcurrant',
      'aria-label': 'Only combos containing this ingredient',
      class: 'recipe-filter',
    });
    ingredientInput.addEventListener('change', () => {
      const v = ingredientInput.value.trim();
      ingredient = db.items[v] ? v : '';
      if (v && !ingredient) ingredientInput.setCustomValidity('Unknown item');
      else ingredientInput.setCustomValidity('');
      fillCombos();
    });
    const ingredientBox = h('label', { class: 'ingredient-row' }, h('span', { class: 'muted small' }, 'With ingredient'), ingredientInput);
    const fillCombos = () => {
      const avoid = new Set(app.plan.veganExclude);
      const allowed = (c: Combo) => poolKind === 'all' || !c.inputs.some(i => avoid.has(i) && i !== ingredient);
      const list = ingredient
        ? findCombosWith(db, poolFor(app, poolKind), ingredient, item, { limitPerOutput: 150 }).filter(allowed)
        : (combos(app, poolKind).get(item) ?? []).filter(allowed).slice(0, 15);
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
          : [
              h(
                'p',
                { class: 'muted' },
                ingredient
                  ? `No combo with ${ingredient} makes ${item}${poolKind === 'herb' ? ' from your sources. Try "All items".' : '.'}`
                  : poolKind === 'herb'
                    ? 'No single-step combo from your sources makes this. Try "All items", or turn on 🌿 Vegan for multi-step chains.'
                    : 'No cauldron combo makes this item.',
              ),
            ]),
      );
    };
    // Defer so the dialog paints before a (possibly ~0.5 s) search.
    setTimeout(fillCombos, 0);

    const isCandidateTarget = db.items[item]?.cauldronTarget !== undefined;
    dlg.replaceChildren(
      h(
        'form',
        {
          method: 'dialog',
          class: 'picker-inner',
          // Enter in a search box triggers implicit submission (= closing the dialog);
          // never submit, the ✕ button closes explicitly.
          onsubmit: (e: Event) => e.preventDefault(),
        },
        h('header', {}, h('h2', {}, item), h('button', { type: 'button', class: 'icon', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')),
        h(
          'div',
          { class: 'picker-actions' },
          h('button', { type: 'button', class: `option small ${current === RAW ? 'selected' : ''}`, onclick: () => choose(RAW) }, '📦 Treat as raw input (don\'t build it)'),
          userPick ? h('button', { type: 'button', class: 'option small', onclick: () => choose(null) }, plan.vegan ? '↺ Reset to vegan/default pick' : '↺ Reset to default') : null,
        ),
        h('h3', {}, 'Recipes'),
        recipeButtons.length ? recipeList(recipeButtons) : h('p', { class: 'muted' }, 'Only obtainable by buying it.'),
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
                  h('button', { type: 'button', class: poolKind === 'herb' ? 'on' : '', onclick: () => ((poolKind = 'herb'), render()) }, '🌿 Your sources'),
                  h('button', { type: 'button', class: poolKind === 'all' ? 'on' : '', onclick: () => ((poolKind = 'all'), render()) }, 'All items'),
                ),
              ),
              h('p', { class: 'muted small' }, 'Any 3 ingredients (Cauldron) or 2 (Advanced Cauldron) whose combined cauldron value lands nearest this item. Sorted by estimated cost.'),
              ingredientBox,
              comboBox,
            )
          : null,
      ),
    );
  };
  render();
  if (!dlg.open) dlg.showModal();
}

/** Recipe options; long lists (e.g. Paradox Crucible: any item) get a filter box. */
function recipeList(buttons: HTMLButtonElement[]): HTMLElement {
  const box = h('div', { class: 'options' }, ...buttons);
  if (buttons.length <= 10) return box;
  const input = h('input', { type: 'search', placeholder: `Filter ${buttons.length} recipes, e.g. Lavender`, 'aria-label': 'Filter recipes', class: 'recipe-filter' });
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    buttons.forEach((b, i) => {
      // Unfiltered: show the first 8 plus the current pick; filtered: every match.
      const match = q ? b.textContent!.toLowerCase().includes(q) : i < 8 || b.classList.contains('selected');
      b.hidden = !match;
    });
  };
  input.addEventListener('input', apply);
  apply();
  return h('div', {}, input, box);
}

function poolFor(app: App, kind: PoolKind): Set<string> {
  const { db, plan } = app;
  return kind === 'all' ? allPool(db) : sourcePool(db, { exclude: plan.veganExclude, depth: plan.veganDepth, rawInCauldron: plan.veganRawInCauldron });
}
