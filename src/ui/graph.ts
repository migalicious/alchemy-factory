import dagre from '@dagrejs/dagre';
import type { App } from './app';
import { fmt, h } from './dom';
import { recipeLabel } from './describe';
import { short } from './table';
import { buildZones, footprint, zoneFlows } from './zones';
import { fmtCoins, rawCoinCost } from '../solver/coins';

const SVG = 'http://www.w3.org/2000/svg';

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

const clip = (t: string, n = 30) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const listClip = (items: string[], n = 3) => (items.length > n ? `${items.slice(0, n).join(', ')} +${items.length - n}` : items.join(', '));

interface GNode {
  id: string;
  kind: 'zone' | 'line' | 'raw' | 'target' | 'surplus' | 'boiler';
  lines: string[]; // text rows; first is the title
  tip: string;
  onClick?: () => void;
  cluster?: string;
}
interface GEdge {
  from: string;
  to: string;
  label: string;
  tip: string;
  weight: number; // stroke width
  /** portal = bought raw input, surplus = leftover byproduct, steam = pipe from boilers. */
  kind: 'belt' | 'portal' | 'surplus' | 'steam';
}

// Belt lines are coloured by the zone they come from, so parallel lines can be told apart.
const PALETTE = ['#7a4fd0', '#2f8f6a', '#c2572e', '#2f79b5', '#b0467f', '#8a7a1f', '#4f5bd5', '#1f8a8a', '#a8541f', '#6d7a2a'];
const colorFor = (key: string) => {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const edgeKind = (from: string, to: string): GEdge['kind'] =>
  from === 'raw' || from.startsWith('raw:') ? 'portal' : to === 'surplus' || to.startsWith('surplus:') ? 'surplus' : 'belt';

type Mode = 'zones' | 'items';
type Dir = 'TB' | 'LR';
let mode: Mode = 'zones';
let dir: Dir = 'LR';
try {
  if (localStorage.getItem('af-planner:graph-mode') === 'items') mode = 'items';
  if (localStorage.getItem('af-planner:graph-dir') === 'TB') dir = 'TB';
} catch {
  /* ignore */
}
let view = { x: 0, y: 0, w: 0, h: 0 };
let lastKey = '';

const itemList = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([i, r]) => `${fmt(r)} ${i}`);

function zoneGraph(app: App): { nodes: GNode[]; edges: GEdge[] } {
  const { result, heat, plan } = app;
  const nodes: GNode[] = [];
  for (const z of buildZones(app)) {
    const fp = footprint(app, z.machine!, z.machines);
    const steam = z.lines.reduce((a, l) => a + (heat.lines.get(l.recipe.id)?.steamPerMin ?? 0), 0);
    const fuel = z.lines.reduce((a, l) => a + (heat.lines.get(l.recipe.id)?.fuelPerMin ?? 0), 0);
    nodes.push({
      id: z.id,
      kind: 'zone',
      lines: [
        `${z.machine} × ${z.machines}`,
        listClip(z.items),
        `${fp.L}×${fp.W}${fp.stack > 1 ? ` · ${fp.stack} per floor` : ''} · ${fp.tiles} tiles${steam ? ` · ♨ ${fmt(steam)}/min` : fuel ? ` · 🔥 ${fmt(fuel)}/min` : ''}`,
      ],
      tip: [`${z.machine} × ${z.machines}`, ...z.lines.map(l => `  ${l.items.join(' + ')}: ${l.machinesCeil} (${recipeLabel(l.recipe)})`)].join('\n'),
      onClick: z.items.length === 1 ? () => app.openPicker(z.items[0]) : undefined,
    });
  }
  const raws = Object.keys(result.raw);
  const coins = rawCoinCost(app.db, result.raw);
  if (raws.length)
    nodes.push({
      id: 'raw',
      kind: 'raw',
      lines: ['🛒 Purchasing Portal', listClip(raws), `${raws.length} item${raws.length === 1 ? '' : 's'} · ${fmtCoins(coins.total)} 🪙/min`],
      tip: Object.entries(result.raw)
        .map(([i, r]) => `${fmt(r)} ${i}/min${coins.perItem[i] !== null ? ` · ${fmtCoins(coins.perItem[i]!)} coins/min` : ''}`)
        .join('\n'),
    });
  const targets = plan.targets.filter(t => t.rate > 0);
  if (targets.length) nodes.push({ id: 'target', kind: 'target', lines: ['🎯 Output', listClip(targets.map(t => `${fmt(t.rate)} ${t.item}`), 2)], tip: targets.map(t => `${fmt(t.rate)}/min ${t.item}`).join('\n') });
  const surplus = Object.keys(result.surplus);
  if (surplus.length) nodes.push({ id: 'surplus', kind: 'surplus', lines: ['↗ Surplus', listClip(surplus)], tip: itemList(new Map(Object.entries(result.surplus))).join('\n') });
  if (heat.boiler) {
    const b = heat.boiler;
    nodes.push({ id: 'boiler', kind: 'boiler', lines: ['♨️ Boiler bank', `${b.boilersCeil} boilers on ${b.furnaces} ${short(b.furnace)}`, `🔥 ${fmt(b.fuelPerMin)} ${plan.settings.fuel}/min`], tip: `${fmt(b.steamPerMin)} steam/min` });
  }

  const edges: GEdge[] = zoneFlows(app).map(f => {
    const names = [...f.items.keys()];
    return { from: f.from, to: f.to, label: listClip(names, 2), tip: itemList(f.items).join('\n'), weight: Math.min(6, 1.2 + names.length * 0.6), kind: edgeKind(f.from, f.to) };
  });
  if (heat.boiler) {
    const steamZones = new Map<string, number>();
    for (const lh of heat.lines.values()) {
      const z = `m:${app.result.lines.find(l => l.recipe.id === lh.recipeId)?.recipe.machine}`;
      if (lh.device === 'Steam Heating Pad') steamZones.set(z, (steamZones.get(z) ?? 0) + lh.steamPerMin);
    }
    for (const [z, st] of steamZones) edges.push({ from: 'boiler', to: z, label: `${fmt(st)} steam`, tip: `${fmt(st)} steam/min`, weight: 1.5, kind: 'steam' });
  }
  return { nodes, edges };
}

function itemGraph(app: App): { nodes: GNode[]; edges: GEdge[] } {
  const { result, heat, plan } = app;
  const nodes: GNode[] = [];
  for (const l of result.lines) {
    const lh = heat.lines.get(l.recipe.id);
    const item = l.items[0] ?? Object.keys(l.outputs)[0];
    nodes.push({
      id: l.recipe.id,
      kind: 'line',
      cluster: `m:${l.recipe.machine}`,
      lines: [l.items.join(' + ') || item, `${l.machinesCeil}× ${recipeLabel(l.recipe)}`, lh ? (lh.device === 'Steam Heating Pad' ? `♨ ${fmt(lh.steamPerMin)} steam/min` : `🔥 ${fmt(lh.fuelPerMin)} ${plan.settings.fuel}/min`) : `${fmt(l.outputs[item] ?? 0)}/min`],
      tip: `${l.items.join(' + ')}\n${recipeLabel(l.recipe)}\n${l.machines.toFixed(2)} machines`,
      onClick: () => app.openPicker(item),
    });
  }
  const coins = rawCoinCost(app.db, result.raw);
  for (const [item, rate] of Object.entries(result.raw)) {
    const c = coins.perItem[item];
    nodes.push({ id: `raw:${item}`, kind: 'raw', lines: [`🛒 ${item}`, `${fmt(rate)}/min${c !== null ? ` · ${fmtCoins(c)} 🪙/min` : ''}`], tip: item, onClick: () => app.openPicker(item) });
  }
  for (const t of plan.targets) if (t.rate > 0) nodes.push({ id: `target:${t.item}`, kind: 'target', lines: [`🎯 ${t.item}`, `${fmt(t.rate)}/min`], tip: t.item });
  for (const [item, rate] of Object.entries(result.surplus)) nodes.push({ id: `surplus:${item}`, kind: 'surplus', lines: [`↗ ${item}`, `surplus ${fmt(rate)}/min`], tip: item });
  if (heat.boiler) {
    const b = heat.boiler;
    nodes.push({ id: 'boiler', kind: 'boiler', lines: ['♨️ Boiler bank', `${b.boilersCeil} boilers on ${b.furnaces} ${short(b.furnace)}`], tip: `${fmt(b.steamPerMin)} steam/min` });
  }
  const pairs = new Map<string, GEdge & { items: Map<string, number> }>();
  for (const f of result.flows) {
    const key = `${f.from}→${f.to}`;
    const e = pairs.get(key) ?? { from: f.from, to: f.to, label: '', tip: '', weight: 1.4, kind: edgeKind(f.from, f.to), items: new Map() };
    e.items.set(f.item, (e.items.get(f.item) ?? 0) + f.rate);
    pairs.set(key, e);
  }
  const edges: GEdge[] = [...pairs.values()].map(e => ({ ...e, label: listClip([...e.items.keys()], 2), tip: itemList(e.items).join('\n') }));
  if (heat.boiler) for (const lh of heat.lines.values()) if (lh.device === 'Steam Heating Pad') edges.push({ from: 'boiler', to: lh.recipeId, label: `${fmt(lh.steamPerMin)} steam`, tip: `${fmt(lh.steamPerMin)} steam/min`, weight: 1.2, kind: 'steam' });
  return { nodes, edges };
}

export function renderGraph(app: App, root: HTMLElement): void {
  if (!app.result.lines.length) {
    root.replaceChildren(h('p', { class: 'muted pad' }, 'Add a target to get started.'));
    return;
  }
  const { nodes, edges } = mode === 'zones' ? zoneGraph(app) : itemGraph(app);
  const W = mode === 'zones' ? 250 : 220;
  const H = 64;
  const ids = new Set(nodes.map(n => n.id));

  const layout = (withClusters: boolean) => {
    const g = new dagre.graphlib.Graph({ compound: withClusters });
    g.setGraph({ rankdir: dir, nodesep: dir === 'LR' ? 16 : 24, ranksep: dir === 'LR' ? 70 : mode === 'zones' ? 70 : 50, marginx: 24, marginy: 24 });
    g.setDefaultEdgeLabel(() => ({}));
    const clusters = new Set<string>();
    for (const n of nodes) {
      g.setNode(n.id, { width: W, height: H });
      if (withClusters && n.cluster) {
        if (!clusters.has(n.cluster)) g.setNode(n.cluster, { label: n.cluster });
        clusters.add(n.cluster);
        g.setParent(n.id, n.cluster);
      }
    }
    // Edges point from ingredient to consumer, so raw inputs sit on top and the target at the bottom.
    // (Weight 0 edges make dagre's compound layout throw, so steam edges get weight 1.)
    for (const e of edges) if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) g.setEdge(e.from, e.to, { weight: e.kind === 'steam' ? 1 : 2, minlen: 1 });
    dagre.layout(g);
    return { g, clusters };
  };
  let laid: ReturnType<typeof layout>;
  try {
    laid = layout(mode === 'items');
  } catch {
    laid = layout(false); // dagre's compound layout can fail on some graphs; fall back to no grouping boxes
  }
  const { g, clusters } = laid;
  const gg = g.graph();
  const gw = gg.width ?? 800;
  const gh = gg.height ?? 600;

  const clusterEls = [...clusters].map(c => {
    const n = g.node(c);
    const machine = c.slice(2);
    const count = app.result.lines.filter(l => l.recipe.machine === machine).reduce((a, l) => a + l.machinesCeil, 0);
    return s(
      'g',
      { class: 'cluster' },
      s('rect', { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height, rx: 12 }),
      s('text', { x: n.x - n.width / 2 + 10, y: n.y - n.height / 2 + 14, class: 'cluster-label' }, `${machine} × ${count}`),
    );
  });

  const edgeEls = edges
    .filter(e => g.hasEdge(e.from, e.to))
    .map(e => {
      const pts: { x: number; y: number }[] = g.edge(e.from, e.to)?.points ?? [];
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
      const mid = pts[Math.floor(pts.length / 2)] ?? { x: 0, y: 0 };
      const el = s(
        'g',
        { class: `edge ${e.kind}`, 'data-from': e.from, 'data-to': e.to },
        s('path', { d, 'marker-end': 'url(#arrow)', 'stroke-width': e.weight, ...(e.kind === 'belt' ? { style: `stroke:${colorFor(e.from)}` } : {}) }),
        s('path', { d, class: 'hit' }),
        s('title', {}, e.tip),
      );
      if (e.label) el.append(s('text', { x: mid.x + 6, y: mid.y, class: 'edge-label' }, clip(e.label, 34)));
      return el;
    });

  const nodeEls = nodes.map(n => {
    const p = g.node(n.id);
    const el = s(
      'g',
      { class: `node ${n.kind}`, 'data-id': n.id, transform: `translate(${p.x - W / 2},${p.y - H / 2})`, tabindex: 0 },
      s('rect', { width: W, height: H, rx: 8 }),
      ...n.lines.map((t, i) => s('text', { x: 10, y: 19 + i * 17, class: i ? 'n-sub' : 'n-title' }, clip(t, i ? 38 : 32))),
      s('title', {}, n.tip),
    );
    return el;
  });

  const svg = s(
    'svg',
    { class: 'graph', role: 'img', 'aria-label': 'Production graph' },
    s('defs', {}, s('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrowhead' }))),
    s('g', {}, ...clusterEls, ...edgeEls, ...nodeEls),
  );

  // Highlight a node's neighbourhood; click a node again (or its recipe) to open the picker.
  const byId = new Map(nodes.map(n => [n.id, n]));
  let focused: string | null = null;
  const focus = (id: string | null) => {
    focused = id;
    svg.classList.toggle('focusing', !!id);
    const near = new Set<string>(id ? [id] : []);
    for (const e of edgeEls) {
      const on = !!id && (e.dataset.from === id || e.dataset.to === id);
      e.classList.toggle('on', on);
      if (on) near.add(e.dataset.from!).add(e.dataset.to!);
    }
    for (const el of nodeEls) el.classList.toggle('on', near.has(el.dataset.id!));
  };
  for (const el of nodeEls) {
    const n = byId.get(el.dataset.id!)!;
    const activate = () => {
      if (focused === n.id && n.onClick) n.onClick();
      else focus(focused === n.id ? null : n.id);
    };
    el.addEventListener('click', e => {
      e.stopPropagation();
      activate();
    });
    el.addEventListener('keydown', e => (e as KeyboardEvent).key === 'Enter' && activate());
  }

  // Pan/zoom; keep the view when only numbers change, refit when the shape changes.
  const key = `${mode}|${dir}|${nodes.map(n => n.id).sort().join('|')}`;
  const refit = key !== lastKey || !view.w;
  lastKey = key;
  const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  /** Show everything if that stays readable; otherwise open at a readable zoom from the inputs end. */
  const initialView = () => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0, w: gw, h: gh };
    const fitScale = Math.min(r.width / gw, r.height / gh); // screen px per graph unit
    const readable = 0.75;
    if (fitScale >= readable) return { x: 0, y: 0, w: gw, h: gh };
    const w = r.width / readable;
    const h = r.height / readable;
    return dir === 'LR' ? { x: 0, y: Math.max(0, (gh - h) / 2), w, h } : { x: Math.max(0, (gw - w) / 2), y: 0, w, h };
  };
  if (!refit) apply();
  svg.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const k = Math.exp(e.deltaY * 0.0015);
      const scale = Math.max(view.w / r.width, view.h / r.height);
      const px = view.x + (e.clientX - r.left) * scale;
      const py = view.y + (e.clientY - r.top) * scale;
      view = { x: px - (px - view.x) * k, y: py - (py - view.y) * k, w: view.w * k, h: view.h * k };
      apply();
    },
    { passive: false },
  );
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  let justDragged = false;
  svg.addEventListener('pointerdown', e => (drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }));
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
  const end = () => {
    justDragged = !!drag?.moved;
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener(
    'click',
    e => {
      if (justDragged) e.stopPropagation();
      else if (e.target === svg) focus(null);
      justDragged = false;
    },
    true,
  );
  svg.addEventListener('click', () => focus(null));

  const setMode = (m: Mode) => {
    mode = m;
    try {
      localStorage.setItem('af-planner:graph-mode', m);
    } catch {
      /* ignore */
    }
    renderGraph(app, root);
  };
  const setDir = (d: Dir) => {
    dir = d;
    try {
      localStorage.setItem('af-planner:graph-dir', d);
    } catch {
      /* ignore */
    }
    renderGraph(app, root);
  };
  root.replaceChildren(
    h(
      'div',
      { class: 'graph-tools' },
      h(
        'div',
        { class: 'seg' },
        h('button', { class: mode === 'zones' ? 'on' : '', onclick: () => setMode('zones') }, 'Zones'),
        h('button', { class: mode === 'items' ? 'on' : '', onclick: () => setMode('items') }, 'Items'),
      ),
      h(
        'div',
        { class: 'seg' },
        h('button', { class: dir === 'LR' ? 'on' : '', title: 'Inputs on the left, output on the right', onclick: () => setDir('LR') }, 'Left → right'),
        h('button', { class: dir === 'TB' ? 'on' : '', title: 'Inputs at the top, output at the bottom', onclick: () => setDir('TB') }, 'Top ↓ down'),
      ),
      h('button', { onclick: () => ((view = { x: 0, y: 0, w: gw, h: gh }), apply()) }, 'Fit'),
      h(
        'span',
        { class: 'muted small' },
        mode === 'zones'
          ? 'One box per machine type — build each as an area. Tap a box to see what it gets and sends; tap empty space to reset.'
          : 'One box per item, grouped by machine. Tap to see its connections, tap again to change its recipe.',
      ),
    ),
    h(
      'div',
      { class: 'legend small' },
      h('span', {}, h('i', { class: 'lg belt' }), 'belt (colour = where it comes from)'),
      h('span', {}, h('i', { class: 'lg portal' }), 'Purchasing Portal'),
      hasBoiler(app) ? h('span', {}, h('i', { class: 'lg steam' }), 'steam pipe') : null,
      h('span', {}, h('i', { class: 'lg surplus' }), 'surplus'),
    ),
    h('div', { class: 'graph-wrap' }, svg),
  );
  if (refit) {
    view = initialView(); // needs the svg in the DOM to know its size
    apply();
  }
}

const hasBoiler = (app: App) => !!app.heat.boiler;
