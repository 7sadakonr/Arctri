/** The window's grid: a tree of splits whose leaves are groups (each group is a row of tabs with one shown). Pure functions only. */

export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type Dir = 'row' | 'col';

export type GroupNode = { type: 'group'; id: string };
export type SplitNode = { type: 'split'; id: string; dir: Dir; children: Node[]; sizes: number[] };
export type Node = GroupNode | SplitNode;

export const MIN_SIZE = 0.08;

const dirOf = (edge: Edge): Dir => (edge === 'left' || edge === 'right' ? 'row' : 'col');
const before = (edge: Edge): boolean => edge === 'left' || edge === 'top';

const normalize = (sizes: number[]): number[] => {
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length);
};

export function groupIds(node: Node | undefined): string[] {
  if (!node) return [];
  return node.type === 'group' ? [node.id] : node.children.flatMap(groupIds);
}

export function hasGroup(node: Node | undefined, id: string): boolean {
  return groupIds(node).includes(id);
}

let splitSeq = 0;
export const newSplitId = (): string => `split-${++splitSeq}`;

/**
 * Shares after a new child is added at `at`: it gets 1/n of the split, the others keep their proportions in the rest.
 * Equal shares stay equal (2 -> 3 -> 4 panes are halves, thirds, quarters), and shares the user has dragged keep their ratio.
 */
export function addSibling(sizes: number[], at: number): number[] {
  const n = sizes.length + 1;
  const next = sizes.map((s) => (s * (n - 1)) / n);
  next.splice(at, 0, 1 / n);
  return next;
}

/**
 * Puts a new, empty group at the given edge of `groupId`. Next to a sibling of the same direction it joins that split with an equal
 * share; otherwise the group is wrapped in a new split where the new group takes `ratio`.
 */
export function splitGroup(root: Node, groupId: string, edge: Edge, newId: string, ratio = 0.5, splitId = newSplitId()): Node {
  const dir = dirOf(edge);
  const fresh: GroupNode = { type: 'group', id: newId };
  const place = (node: Node): Node => {
    if (node.type === 'group') {
      if (node.id !== groupId) return node;
      return {
        type: 'split',
        id: splitId,
        dir,
        children: before(edge) ? [fresh, node] : [node, fresh],
        sizes: before(edge) ? [ratio, 1 - ratio] : [1 - ratio, ratio]
      };
    }
    const i = node.children.findIndex((c) => c.type === 'group' && c.id === groupId);
    if (i >= 0 && node.dir === dir) {
      // same direction as the parent: one more sibling, with an equal share
      const at = before(edge) ? i : i + 1;
      const children = [...node.children];
      children.splice(at, 0, fresh);
      return { ...node, children, sizes: addSibling(node.sizes, at) };
    }
    return { ...node, children: node.children.map(place) };
  };
  return place(root);
}

/**
 * Puts a new group along a whole edge of the grid (not of one pane): it spans the full width or height. With a root that
 * already splits that way the group joins it; otherwise the whole grid is wrapped in a new split.
 */
export function splitRoot(root: Node, edge: Edge, newId: string, ratio = 0.5, splitId = newSplitId()): Node {
  const dir = dirOf(edge);
  const fresh: GroupNode = { type: 'group', id: newId };
  if (root.type === 'split' && root.dir === dir) {
    return before(edge)
      ? { ...root, children: [fresh, ...root.children], sizes: addSibling(root.sizes, 0) }
      : { ...root, children: [...root.children, fresh], sizes: addSibling(root.sizes, root.sizes.length) };
  }
  return {
    type: 'split',
    id: splitId,
    dir,
    children: before(edge) ? [fresh, root] : [root, fresh],
    sizes: before(edge) ? [ratio, 1 - ratio] : [1 - ratio, ratio]
  };
}

/** A new group between children `index` and `index + 1` of a split, the full length of the divider, with an equal share. */
export function insertAtDivider(root: Node, splitId: string, index: number, newId: string): Node {
  const fresh: GroupNode = { type: 'group', id: newId };
  const apply = (node: Node): Node => {
    if (node.type === 'group') return node;
    if (node.id === splitId && index >= 0 && index < node.children.length - 1) {
      const children = [...node.children];
      children.splice(index + 1, 0, fresh);
      return { ...node, children, sizes: addSibling(node.sizes, index + 1) };
    }
    return { ...node, children: node.children.map(apply) };
  };
  return apply(root);
}

export interface Box { x: number; y: number; w: number; h: number }

/** The area each group gets in `box` (dividers take no room here), by walking the splits. */
export function layoutRects(root: Node | undefined, box: Box): Record<string, Box> {
  const out: Record<string, Box> = {};
  const walk = (node: Node, r: Box) => {
    if (node.type === 'group') {
      out[node.id] = r;
      return;
    }
    let at = 0;
    node.children.forEach((child, i) => {
      const share = node.sizes[i]!;
      walk(child, node.dir === 'row' ? { x: r.x + at * r.w, y: r.y, w: share * r.w, h: r.h } : { x: r.x, y: r.y + at * r.h, w: r.w, h: share * r.h });
      at += share;
    });
  };
  if (root) walk(root, box);
  return out;
}

/** Takes a group out; a split left with one child gives way to it, and a split inside a split of the same direction is merged. */
export function removeGroup(root: Node, groupId: string): Node | undefined {
  const drop = (node: Node): Node | undefined => {
    if (node.type === 'group') return node.id === groupId ? undefined : node;
    const kept: Array<{ node: Node; size: number }> = [];
    node.children.forEach((c, i) => {
      const n = drop(c);
      if (n) kept.push({ node: n, size: node.sizes[i]! });
    });
    if (kept.length === 0) return undefined;
    if (kept.length === 1) return kept[0]!.node;
    // merge children that split the same way as this node
    const children: Node[] = [];
    const sizes: number[] = [];
    for (const k of kept) {
      if (k.node.type === 'split' && k.node.dir === node.dir) {
        k.node.children.forEach((c, i) => {
          children.push(c);
          sizes.push(k.node.type === 'split' ? k.node.sizes[i]! * k.size : 0);
        });
      } else {
        children.push(k.node);
        sizes.push(k.size);
      }
    }
    return { ...node, children, sizes: normalize(sizes) };
  };
  return drop(root);
}

/** New shares for the children of one split (each at least MIN_SIZE, together 1). */
export function setSizes(root: Node, splitId: string, sizes: number[]): Node {
  const apply = (node: Node): Node => {
    if (node.type === 'group') return node;
    if (node.id === splitId) {
      if (sizes.length !== node.children.length) return node;
      return { ...node, sizes: normalize(sizes.map((s) => Math.max(MIN_SIZE, s))) };
    }
    return { ...node, children: node.children.map(apply) };
  };
  return apply(root);
}

/** Moves the divider after child `index` by `delta` (a share of the split), taking from the neighbour; stops at the minimum. */
export function dragDivider(sizes: number[], index: number, delta: number): number[] {
  const next = [...sizes];
  const a = next[index];
  const b = next[index + 1];
  if (a === undefined || b === undefined) return sizes;
  const d = Math.max(MIN_SIZE - a, Math.min(b - MIN_SIZE, delta));
  next[index] = a + d;
  next[index + 1] = b - d;
  return next;
}

/** The group before/after `groupId` in reading order, wrapping around. */
export function stepGroup(root: Node | undefined, groupId: string, dir: 1 | -1): string | undefined {
  const ids = groupIds(root);
  if (ids.length === 0) return undefined;
  const i = ids.indexOf(groupId);
  return ids[(i + dir + ids.length) % ids.length];
}
