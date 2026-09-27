import dagre from '@dagrejs/dagre';
import type { App } from './app';
import { fmt, h } from './dom';
import { recipeLabel } from './describe';
import { short } from './table';

const SVG = 'http://www.w3.org/2000/svg';
const W = 210;
const H = 62;

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

const clip = (t: string, n = 28) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

interface GNode {
  id: string;
  kind: 'line' | 'raw' | 'target' | 'surplus' | 'boiler';
  title: string;
  sub: string;
  sub2?: string;
  item?: string;
}

let view = { x: 0, y: 0, w: 0, h: 0 };
let lastKey = '';

export function renderGraph(app: App, root: HTMLElement): void {
  const { result, heat, plan } = app;
  if (!result.lines.length) {
    root.replaceChildren(h('p', { class: 'muted pad' }, 'Add a target to get started.'));
    return;
  }
  const nodes = new Map<string, GNode>();
  for (const l of result.lines) {
    const lh = heat.lines.get(l.recipe.id);
    const item = l.items[0] ?? Object.keys(l.outputs)[0];
    nodes.set(l.recipe.id, {
      id: l.recipe.id,
      kind: 'line',
      item,
      title: l.items.join(' + ') || item,
      sub: `${l.machinesCeil}× ${clip(recipeLabel(l.recipe), 22)}`,
      sub2: lh ? (lh.device === 'Steam Heating Pad' ? `♨ ${fmt(lh.steamPerMin)} steam/min` : `🔥 ${fmt(lh.fuelPerMin)} ${plan.settings.fuel}/min`) : undefined,
    });
  }
  for (const [item, rate] of Object.entries(result.raw)) nodes.set(`raw:${item}`, { id: `raw:${item}`, kind: 'raw', item, title: item, sub: `raw · ${fmt(rate)}/min` });
  for (const t of plan.targets) if (t.rate > 0) nodes.set(`target:${t.item}`, { id: `target:${t.item}`, kind: 'target', item: t.item, title: `🎯 ${t.item}`, sub: `${fmt(t.rate)}/min` });
  for (const [item, rate] of Object.entries(result.surplus)) nodes.set(`surplus:${item}`, { id: `surplus:${item}`, kind: 'surplus', item, title: `↗ ${item}`, sub: `surplus ${fmt(rate)}/min` });
  if (heat.boiler) {
    const b = heat.boiler;
    nodes.set('boiler', { id: 'boiler', kind: 'boiler', title: '♨️ Boiler bank', sub: `${b.boilersCeil} boilers · ${b.furnaces} ${short(b.furnace)}`, sub2: `🔥 ${fmt(b.fuelPerMin)} ${plan.settings.fuel}/min` });
  }

  // Merge flows between the same pair of nodes.
  const edges = new Map<string, { from: string; to: string; label: string[]; steam?: boolean }>();
  for (const f of result.flows) {
    if (!nodes.has(f.from) || !nodes.has(f.to)) continue;
    const key = `${f.from}→${f.to}`;
    const e = edges.get(key) ?? { from: f.from, to: f.to, label: [] };
    e.label.push(`${fmt(f.rate)} ${f.item}`);
    edges.set(key, e);
  }
  if (heat.boiler) {
    for (const lh of heat.lines.values()) {
      if (lh.device === 'Steam Heating Pad') edges.set(`boiler→${lh.recipeId}`, { from: 'boiler', to: lh.recipeId, label: [`${fmt(lh.steamPerMin)} steam`], steam: true });
    }
  }

  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({ rankdir: 'RL', nodesep: 18, ranksep: 80, edgesep: 10, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes.values()) g.setNode(n.id, { width: W, height: H });
  for (const e of edges.values()) g.setEdge(e.from, e.to, { weight: e.steam ? 0 : 1, minlen: e.steam ? 1 : 1 });
  dagre.layout(g);
  const gg = g.graph();
  const gw = gg.width ?? 800;
  const gh = gg.height ?? 600;

  const edgeEls = [...edges.values()].map(e => {
    const pts: { x: number; y: number }[] = g.edge(e.from, e.to)?.points ?? [];
    if (!pts.length) return s('g');
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
    const mid = pts[Math.floor(pts.length / 2)];
    const label = e.label.length > 2 ? [...e.label.slice(0, 2), `+${e.label.length - 2} more`] : e.label;
    return s(
      'g',
      { class: `edge ${e.steam ? 'steam' : ''}` },
      s('path', { d, 'marker-end': 'url(#arrow)' }),
      s('title', {}, e.label.join('\n')),
      ...(e.steam ? [] : label.map((t, i) => s('text', { x: mid.x, y: mid.y - 4 + i * 12, 'text-anchor': 'middle', class: 'edge-label' }, clip(t, 26)))),
    );
  });

  const nodeEls = [...nodes.values()].map(n => {
    const p = g.node(n.id);
    const el = s(
      'g',
      { class: `node ${n.kind}`, transform: `translate(${p.x - W / 2},${p.y - H / 2})`, tabindex: n.item ? 0 : -1 },
      s('rect', { width: W, height: H, rx: 8 }),
      s('text', { x: 10, y: 19, class: 'n-title' }, clip(n.title)),
      s('text', { x: 10, y: 36, class: 'n-sub' }, clip(n.sub, 32)),
      n.sub2 ? s('text', { x: 10, y: 52, class: 'n-sub' }, clip(n.sub2, 32)) : '',
      s('title', {}, [n.title, n.sub, n.sub2 ?? ''].join('\n')),
    );
    if (n.item) {
      const open = () => app.openPicker(n.item!);
      el.addEventListener('click', open);
      el.addEventListener('keydown', e => (e as KeyboardEvent).key === 'Enter' && open());
    }
    return el;
  });

  const svg = s(
    'svg',
    { class: 'graph', role: 'img', 'aria-label': 'Production graph' },
    s('defs', {}, s('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrowhead' }))),
    s('g', {}, ...edgeEls, ...nodeEls),
  );

  // Keep pan/zoom when only numbers change; refit when the graph's shape changes.
  const key = [...nodes.keys()].sort().join('|');
  if (key !== lastKey || !view.w) view = { x: 0, y: 0, w: gw, h: gh };
  lastKey = key;
  const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  apply();

  svg.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const k = Math.exp((e as WheelEvent).deltaY * 0.0015);
      const scale = Math.max(view.w / r.width, view.h / r.height);
      const px = view.x + ((e as WheelEvent).clientX - r.left) * scale;
      const py = view.y + ((e as WheelEvent).clientY - r.top) * scale;
      view = { x: px - (px - view.x) * k, y: py - (py - view.y) * k, w: view.w * k, h: view.h * k };
      apply();
    },
    { passive: false },
  );
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  svg.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    const scale = Math.max(view.w / r.width, view.h / r.height);
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4 && !drag.moved) {
      drag.moved = true;
      svg.setPointerCapture(e.pointerId);
    }
    if (drag.moved) {
      view = { ...view, x: drag.vx - dx * scale, y: drag.vy - dy * scale };
      apply();
    }
  });
  let justDragged = false;
  const end = () => {
    justDragged = !!drag?.moved;
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  // Swallow the click that ends a drag so it doesn't open the picker.
  svg.addEventListener(
    'click',
    e => {
      if (justDragged) e.stopPropagation();
      justDragged = false;
    },
    true,
  );

  const fit = () => {
    view = { x: 0, y: 0, w: gw, h: gh };
    apply();
  };
  root.replaceChildren(
    h(
      'div',
      { class: 'graph-tools' },
      h('button', { onclick: fit }, 'Fit'),
      h('span', { class: 'muted small' }, 'Scroll to zoom · drag to pan · click a box to change its recipe · each item appears once'),
    ),
    h('div', { class: 'graph-wrap' }, svg),
  );
}
