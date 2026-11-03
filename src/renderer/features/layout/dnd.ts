import { useEffect } from 'react';
import { create } from 'zustand';
import type { DropTarget, Zone } from './model';
import type { Edge } from './tree';

export type { DropTarget, Zone };

/** Dragged tabs are told apart from anything else dragged over the window (a file from Explorer, text). */
export const TAB_MIME = 'application/x-arctri-tab';

export interface Rect { x: number; y: number; w: number; h: number }

export const sameTarget = (a: DropTarget | undefined, b: DropTarget | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface GroupGeo {
  id: string;
  /** The tab strip and the area below it, in workspace coordinates. */
  /** The whole group: its tab strip and the area below it. */
  rect: Rect;
  strip: Rect;
  body: Rect;
  /** The tabs that are drawn, with the index each has in its group and the middle of it. */
  tabs: Array<{ index: number; x: number; w: number }>;
}

/** A divider between two panes, in workspace coordinates. */
export interface DividerGeo {
  splitId: string;
  /** The divider after child `index` of the split. */
  index: number;
  dir: 'row' | 'col';
  rect: Rect;
  /** The groups on either side of it. */
  adjacent: string[];
  /** The pane right before / after it when that side is one pane (not a nested split), else ''. */
  before: string;
  after: string;
}

export interface Geo {
  workspace: Rect;
  groups: GroupGeo[];
  dividers?: DividerGeo[];
  /** How the window is divided at the top level (to tell which drop zones would give the same layout). */
  rootInfo?: { single: boolean; dir?: 'row' | 'col'; first: string; last: string };
}

export interface DragInfo {
  key: string;
  sourceGroup: string | undefined;
  /** The dragged tab is the only one of its group (so that group would go away). */
  sourceAlone: boolean;
  groupCount: number;
}

interface DragState {
  /** The key of the tab being dragged; the data of a drag cannot be read while it is still going on, so it is kept here. */
  key: string | undefined;
  info: DragInfo | undefined;
  target: DropTarget | undefined;
  /** The pane the pointer is over (it gets the compass), whatever the target is. */
  hover: string | undefined;
  /** Where the pointer was when the target last changed (the preview grows from there). */
  point: { x: number; y: number };
  begin(info: DragInfo): void;
  setTarget(target: DropTarget | undefined, point?: { x: number; y: number }): void;
  setHover(id: string | undefined): void;
  end(): void;
}

export const useDrag = create<DragState>()((set) => ({
  key: undefined,
  info: undefined,
  target: undefined,
  hover: undefined,
  point: { x: 0, y: 0 },
  begin: (info) => set({ key: info.key, info, target: undefined, hover: undefined }),
  setTarget: (target, point) => set((s) => ({ target, point: point ?? s.point })),
  setHover: (hover) => set((s) => (s.hover === hover ? s : { hover })),
  end: () => set({ key: undefined, info: undefined, target: undefined, hover: undefined })
}));

/** The chip that follows the pointer while a tab is dragged (rounded, in the theme's colours) instead of the browser's own picture. */
function dragChip(label: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = label;
  Object.assign(el.style, {
    position: 'fixed', top: '-1000px', left: '-1000px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    padding: '6px 12px', font: '12px system-ui, sans-serif', color: 'var(--ad-fg)', background: 'var(--ad-surface)',
    border: '1px solid var(--ad-border-strong)', borderRadius: 'var(--ad-radius-lg, 12px)', boxShadow: 'var(--ad-shadow-float)'
  });
  return el;
}

export function startTabDrag(e: React.DragEvent, info: DragInfo, label: string): void {
  e.dataTransfer.setData(TAB_MIME, info.key);
  e.dataTransfer.effectAllowed = 'move';
  const chip = dragChip(label);
  document.body.appendChild(chip);
  e.dataTransfer.setDragImage(chip, 14, 16);
  setTimeout(() => chip.remove(), 0);
  // after the browser has taken its drag image: changing the page inside dragstart can cancel the drag
  setTimeout(() => useDrag.getState().begin(info), 0);
}

/** Forgets a drag that ended without a drop on us (dropped elsewhere, cancelled with Escape, or its tab was moved away). */
export function useDragCleanup(): void {
  useEffect(() => {
    const clear = () => useDrag.getState().end();
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);
}

/** The middle of a pane (where the tab joins the pane's tabs) is 40 % of it, but at least this big (and at most 60 %). */
const CENTER_SHARE = 0.4;
const CENTER_MIN = { w: 120, h: 80 };
/** A pane is not split when the half the new pane would get is smaller than this. */
export const MIN_SPLIT = { w: 160, h: 100 };
/** Bias (a share of the pane) for the side the pointer was in last time, and extra reach for the middle: no flicker on a border. */
const SIDE_BIAS = 0.03;

/**
 * Which part of a pane the pointer is over: a box in the middle joins as a tab, and the rest is cut by the pane's diagonals
 * into four halves, so being in the left half of the pane means "split to the left". `sticky` is the zone it was in a
 * moment ago, which is kept a little longer.
 */
export function zoneAt(x: number, y: number, w: number, h: number, sticky?: Zone): Zone {
  if (w <= 0 || h <= 0) return 'center';
  const half = (dim: number, min: number) => Math.min(0.3 * dim, Math.max((CENTER_SHARE / 2) * dim, min / 2));
  const grow = sticky === 'center' ? STICKY_PX : sticky ? -STICKY_PX : 0;
  const hw = Math.max(0, half(w, CENTER_MIN.w) + grow), hh = Math.max(0, half(h, CENTER_MIN.h) + grow);
  if (Math.abs(x - w / 2) <= hw && Math.abs(y - h / 2) <= hh) return 'center';
  const fx = x / w, fy = y / h;
  const d: Array<[Edge, number]> = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]];
  return d.reduce((a, c) => (c[1] - (c[0] === sticky ? SIDE_BIAS : 0) < a[1] - (a[0] === sticky ? SIDE_BIAS : 0) ? c : a))[0];
}

export const ZONE_LABEL: Record<Zone, 'drop.left' | 'drop.right' | 'drop.top' | 'drop.bottom' | 'drop.into'> = {
  left: 'drop.left', right: 'drop.right', top: 'drop.top', bottom: 'drop.bottom', center: 'drop.into'
};


const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Size and gap of the compass buttons (the smaller size is for panes under 160 px). */
const COMPASS_PX = 36;
const COMPASS_SMALL_PX = 28;
const COMPASS_GAP = 8;
/** The compass buttons and edge bars also take a drop a little outside what is drawn. */
const COMPASS_SLACK = 8;
/** The window-edge bars: how long and how thick the area that takes a drop is (the line drawn in it is thinner). */
const ROOT_BAR_LEN = 96;
const ROOT_BAR_THICK = 32;
/** The bar at the top sits below the tab strips. */
const ROOT_BAR_TOP = 40;

/** The five buttons of the compass, as a cross in the middle of a pane's body (workspace coordinates). */
export function compassRects(body: Rect): Record<Zone, Rect> {
  const s = body.w < 160 || body.h < 160 ? COMPASS_SMALL_PX : COMPASS_PX;
  const cx = body.x + body.w / 2 - s / 2;
  const cy = body.y + body.h / 2 - s / 2;
  const step = s + COMPASS_GAP;
  const at = (dx: number, dy: number): Rect => ({ x: cx + dx * step, y: cy + dy * step, w: s, h: s });
  return { center: at(0, 0), left: at(-1, 0), right: at(1, 0), top: at(0, -1), bottom: at(0, 1) };
}

/** The four bars in the middle of the window's edges: a pane across the whole width or height. */
export function rootButtonRects(ws: Rect): Record<Edge, Rect> {
  const L = ROOT_BAR_LEN, T = ROOT_BAR_THICK;
  return {
    left: { x: 0, y: ws.h / 2 - L / 2, w: T, h: L },
    right: { x: ws.w - T, y: ws.h / 2 - L / 2, w: T, h: L },
    top: { x: ws.w / 2 - L / 2, y: ROOT_BAR_TOP, w: L, h: T },
    bottom: { x: ws.w / 2 - L / 2, y: ws.h - T, w: L, h: T }
  };
}

const grow = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });

const STICKY_PX = 16;

/** How far each side of a divider still counts as "on the divider". */
export const DIVIDER_PX = 14;

/** How far from the outer edge of the workspace a drop still counts as "along the whole edge". */
export const ROOT_EDGE_PX = 48;
/** The top edge of the window is the tab strips, so only this rim counts for "along the top". */
export const ROOT_TOP_RIM_PX = 14;
/** A tab strip also takes drops this far below it. */
export const STRIP_SLACK_PX = 8;
/** A zone is kept until the pointer is this much beyond its border, so the preview does not flicker at a border. */

/** The one place that decides where a drop would land, from the pointer position (workspace coordinates) and the measured layout. */
export function dropTargetAt(p: { x: number; y: number }, geo: Geo, prev: DropTarget | undefined, drag: DragInfo): DropTarget | undefined {
  const ws = geo.workspace;
  if (!inside({ x: 0, y: 0, w: ws.w, h: ws.h }, p.x, p.y)) return undefined;

  // the buttons of the window's edges, then the compass of the pane under the pointer: pointing at a button is exact
  const single0 = geo.rootInfo?.single ?? drag.groupCount === 1;
  if (!single0) {
    const btn = rootButtonRects(ws);
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) if (inside(grow(btn[edge], COMPASS_SLACK), p.x, p.y)) return { kind: 'root', edge };
  }
  const under = geo.groups.find((g) => inside(g.rect, p.x, p.y));
  if (under) {
    const c = compassRects(under.body);
    const own = drag.sourceAlone && drag.sourceGroup === under.id; // it cannot be split off itself
    for (const z of ZONES) {
      if (own && z !== 'center') continue;
      if (!inside(grow(c[z], COMPASS_SLACK), p.x, p.y)) continue;
      return z === 'center' ? { kind: 'pane', groupId: under.id, zone: 'center' } : canonicalSide(under.id, z, geo, drag);
    }
  }

  // on the line between two panes: a new pane the full length of that line
  for (const d of geo.dividers ?? []) {
    const hit = d.dir === 'row'
      ? { x: d.rect.x - DIVIDER_PX, y: d.rect.y, w: d.rect.w + 2 * DIVIDER_PX, h: d.rect.h }
      : { x: d.rect.x, y: d.rect.y - DIVIDER_PX, w: d.rect.w, h: d.rect.h + 2 * DIVIDER_PX };
    if (!inside(hit, p.x, p.y)) continue;
    // next to the only tab of its own group this would put the tab back where it is
    if (drag.sourceAlone && drag.sourceGroup && d.adjacent.includes(drag.sourceGroup)) continue;
    return { kind: 'divider', splitId: d.splitId, index: d.index };
  }

  // a tab strip: insert at the position the pointer is at
  for (const g of geo.groups) {
    if (!inside({ ...g.strip, h: g.strip.h + STRIP_SLACK_PX }, p.x, p.y)) continue;
    const before = g.tabs.filter((t) => t.x + t.w / 2 < p.x);
    const index = before.length > 0 ? before[before.length - 1]!.index + 1 : (g.tabs[0]?.index ?? 0);
    return { kind: 'strip', groupId: g.id, index };
  }

  // along an outer edge of the whole window; with a single pane that is just the pane's own side, so it has no zone of its own
  const single = geo.rootInfo?.single ?? drag.groupCount === 1;
  if (!single) {
    const dL = p.x, dR = ws.w - p.x, dT = p.y, dB = ws.h - p.y;
    const near: Array<[Edge, number]> = [['left', dL], ['right', dR], ['bottom', dB]];
    if (dT < ROOT_TOP_RIM_PX) near.push(['top', dT]);
    const [edge, dist] = near.reduce((a, b) => (b[1] < a[1] ? b : a));
    if (dist < ROOT_EDGE_PX) return { kind: 'root', edge };
  }

  for (const g of geo.groups) {
    if (!inside(g.body, p.x, p.y)) continue;
    const x = p.x - g.body.x, y = p.y - g.body.y;
    if (drag.sourceAlone && drag.sourceGroup === g.id) return { kind: 'pane', groupId: g.id, zone: 'center' }; // cannot split off itself
    const make = (z: Zone): DropTarget => (z === 'center' ? { kind: 'pane', groupId: g.id, zone: 'center' } : canonicalSide(g.id, z, geo, drag));
    // the zone it was in a moment ago (found from the previous target) is kept a little longer
    const prevZone = prev ? ZONES.find((z) => sameTarget(make(z), prev)) : undefined;
    const target = make(zoneAt(x, y, g.body.w, g.body.h, prevZone));
    return target;
  }
  return undefined;
}

const ZONES: Zone[] = ['center', 'left', 'right', 'top', 'bottom'];

/**
 * The target for the side `zone` of pane `groupId`. Where that side is the edge of the window, or the border with a
 * neighbouring pane, splitting there gives the same layout as dropping on the window's edge or on the divider, so it is
 * that one target (with an equal share for the new pane) and not three that differ only in size.
 */
export function canonicalSide(groupId: string, zone: Edge, geo: Geo, drag: DragInfo): DropTarget {
  // not into a pane that is too small for the half the new one would get: it joins the tabs instead
  const g = geo.groups.find((x) => x.id === groupId);
  if (g && (zone === 'left' || zone === 'right' ? g.rect.w / 2 < MIN_SPLIT.w : g.rect.h / 2 < MIN_SPLIT.h)) return { kind: 'pane', groupId, zone: 'center', small: true };
  const info = geo.rootInfo;
  if (info && !info.single && info.dir) {
    const first = zone === (info.dir === 'row' ? 'left' : 'top');
    const last = zone === (info.dir === 'row' ? 'right' : 'bottom');
    if ((first && info.first === groupId) || (last && info.last === groupId)) return { kind: 'root', edge: zone };
  }
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
  const after = zone === 'right' || zone === 'bottom'; // the neighbour is after this pane
  const d = geo.dividers?.find((x) => x.dir === dir && (after ? x.before === groupId : x.after === groupId));
  // next to the only tab of its own pane this would put the tab back where it is
  if (d && !(drag.sourceAlone && drag.sourceGroup && d.adjacent.includes(drag.sourceGroup))) return { kind: 'divider', splitId: d.splitId, index: d.index };
  return { kind: 'pane', groupId, zone };
}

/** The slim marker at the slot where a dropped tab would sit in a tab strip (workspace coordinates). */
export function slotRect(g: GroupGeo, index: number): Rect {
  const at = g.tabs.find((tab) => tab.index === index);
  const last = g.tabs[g.tabs.length - 1];
  const x = at ? at.x : last ? last.x + last.w : g.strip.x;
  return { x: x - 2, y: g.strip.y + 5, w: 4, h: g.strip.h - 10 };
}
