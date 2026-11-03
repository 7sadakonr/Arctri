import { describe, expect, it } from 'vitest';
import { addSibling, dragDivider, groupIds, insertAtDivider, layoutRects, MIN_SIZE, removeGroup, setSizes, splitGroup, splitRoot, stepGroup, type Node } from './tree';

const g = (id: string): Node => ({ type: 'group', id });
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('splitGroup', () => {
  it('splits a lone group in each of the four directions', () => {
    const right = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    expect(right).toMatchObject({ type: 'split', dir: 'row', sizes: [0.5, 0.5] });
    expect(groupIds(right)).toEqual(['a', 'b']);
    expect(groupIds(splitGroup(g('a'), 'a', 'left', 'b', 0.5, 's1'))).toEqual(['b', 'a']);
    const down = splitGroup(g('a'), 'a', 'bottom', 'b', 0.5, 's1');
    expect(down).toMatchObject({ type: 'split', dir: 'col' });
    expect(groupIds(down)).toEqual(['a', 'b']);
    expect(groupIds(splitGroup(g('a'), 'a', 'top', 'b', 0.5, 's1'))).toEqual(['b', 'a']);
  });

  it('adds a sibling when the parent splits the same way, with an equal share', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const three = splitGroup(two, 'b', 'right', 'c', 0.5, 's2');
    expect(three).toMatchObject({ type: 'split', dir: 'row' });
    if (three.type !== 'split') throw new Error();
    expect(three.children).toHaveLength(3);
    expect(three.sizes.every((s) => Math.abs(s - 1 / 3) < 1e-9)).toBe(true);
  });

  it('nests when the direction differs', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const nested = splitGroup(two, 'b', 'bottom', 'c', 0.4, 's2');
    if (nested.type !== 'split') throw new Error();
    expect(nested.children[1]).toMatchObject({ type: 'split', dir: 'col', sizes: [0.6, 0.4] });
    expect(groupIds(nested)).toEqual(['a', 'b', 'c']);
  });
});

describe('removeGroup', () => {
  it('collapses a split left with one child', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    expect(removeGroup(two, 'b')).toEqual(g('a'));
  });

  it('removes the last group', () => {
    expect(removeGroup(g('a'), 'a')).toBeUndefined();
  });

  it('merges a nested split of the same direction into its parent and keeps the shares summing to 1', () => {
    const t1 = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const t2 = splitGroup(t1, 'b', 'bottom', 'c', 0.5, 's2');
    const t3 = splitGroup(t2, 'c', 'right', 'd', 0.5, 's3'); // row[a, col[b, row[c, d]]]
    const out = removeGroup(t3, 'b'); // col collapses to row[c, d], which merges into the outer row
    if (!out || out.type !== 'split') throw new Error();
    expect(out.dir).toBe('row');
    expect(groupIds(out)).toEqual(['a', 'c', 'd']);
    expect(sum(out.sizes)).toBeCloseTo(1);
  });
});

describe('sizes', () => {
  it('setSizes normalises and respects the minimum', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const out = setSizes(two, 's1', [0.99, 0.0001]);
    if (out.type !== 'split') throw new Error();
    expect(sum(out.sizes)).toBeCloseTo(1);
    expect(Math.min(...out.sizes)).toBeGreaterThanOrEqual(MIN_SIZE / 1.1);
  });

  it('dragDivider moves a divider and stops at the minimum', () => {
    expect(dragDivider([0.5, 0.5], 0, 0.2)).toEqual([0.7, 0.3]);
    const stopped = dragDivider([0.5, 0.5], 0, 0.9);
    expect(stopped[1]).toBeCloseTo(MIN_SIZE);
    expect(sum(stopped)).toBeCloseTo(1);
    expect(dragDivider([1], 0, 0.1)).toEqual([1]);
  });
});

describe('stepGroup', () => {
  it('walks the groups in reading order and wraps', () => {
    const t = splitGroup(splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1'), 'b', 'right', 'c', 0.5, 's2');
    expect(stepGroup(t, 'a', 1)).toBe('b');
    expect(stepGroup(t, 'c', 1)).toBe('a');
    expect(stepGroup(t, 'a', -1)).toBe('c');
    expect(stepGroup(undefined, 'a', 1)).toBeUndefined();
  });
});

describe('splitRoot', () => {
  it('puts a group along the whole bottom of a left/right split, under both columns', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const out = splitRoot(two, 'bottom', 'c', 0.5, 's2');
    expect(out).toMatchObject({ type: 'split', dir: 'col', sizes: [0.5, 0.5] });
    if (out.type !== 'split') throw new Error();
    expect(out.children[0]).toBe(two);
    expect(out.children[1]).toEqual(g('c'));
  });

  it('wraps on the other side for top / left', () => {
    expect(groupIds(splitRoot(g('a'), 'top', 'c', 0.3, 's1'))).toEqual(['c', 'a']);
    expect(groupIds(splitRoot(g('a'), 'left', 'c', 0.3, 's1'))).toEqual(['c', 'a']);
  });

  it('joins a root that already splits that way, with an equal share', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const out = splitRoot(two, 'right', 'c', 0.2, 's2');
    if (out.type !== 'split') throw new Error();
    expect(out.id).toBe('s1');
    expect(groupIds(out)).toEqual(['a', 'b', 'c']);
    for (const s of out.sizes) expect(s).toBeCloseTo(1 / 3);
    expect(sum(out.sizes)).toBeCloseTo(1);
  });
});

describe('insertAtDivider', () => {
  it('puts a new group between two columns, taking a third of what both gave', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const out = insertAtDivider(two, 's1', 0, 'n');
    if (out.type !== 'split') throw new Error();
    expect(groupIds(out)).toEqual(['a', 'n', 'b']);
    expect(out.sizes[0]).toBeCloseTo(1 / 3);
    expect(out.sizes[1]).toBeCloseTo(1 / 3);
    expect(out.sizes[2]).toBeCloseTo(1 / 3);
    expect(sum(out.sizes)).toBeCloseTo(1);
  });

  it('works inside a nested split and leaves other splits alone', () => {
    const t1 = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const t2 = splitGroup(t1, 'b', 'bottom', 'c', 0.5, 's2'); // a | (b / c)
    const out = insertAtDivider(t2, 's2', 0, 'n');
    expect(groupIds(out)).toEqual(['a', 'b', 'n', 'c']);
    if (out.type !== 'split') throw new Error();
    expect(out.sizes).toEqual([0.5, 0.5]);
  });

  it('ignores a divider that does not exist', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    expect(insertAtDivider(two, 's1', 1, 'n')).toEqual(two);
    expect(insertAtDivider(two, 'nope', 0, 'n')).toEqual(two);
  });
});

describe('layoutRects', () => {
  const box = { x: 0, y: 0, w: 900, h: 600 };
  it('divides by the sizes, columns then rows', () => {
    const t1 = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    const t2 = splitGroup(t1, 'b', 'bottom', 'c', 0.5, 's2');
    const r = layoutRects(t2, box);
    expect(r['a']).toEqual({ x: 0, y: 0, w: 450, h: 600 });
    expect(r['b']).toEqual({ x: 450, y: 0, w: 450, h: 300 });
    expect(r['c']).toEqual({ x: 450, y: 300, w: 450, h: 300 });
  });
  it('a root group takes everything, no root nothing', () => {
    expect(layoutRects(g('a'), box)['a']).toEqual(box);
    expect(layoutRects(undefined, box)).toEqual({});
  });
});

describe('equal shares', () => {
  it('splitting again and again gives halves, thirds, quarters', () => {
    let t: Node = g('a');
    t = splitGroup(t, 'a', 'right', 'b', 0.5, 's1');
    expect((t as { sizes: number[] }).sizes).toEqual([0.5, 0.5]);
    t = splitGroup(t, 'b', 'right', 'c');
    t = splitGroup(t, 'c', 'right', 'd');
    const sizes = (t as { sizes: number[] }).sizes;
    expect(sizes).toHaveLength(4);
    for (const s of sizes) expect(s).toBeCloseTo(0.25);
  });

  it('addSibling keeps the ratio of shares that were dragged to something else', () => {
    const next = addSibling([0.6, 0.4], 1);
    expect(next[1]).toBeCloseTo(1 / 3);
    expect(next[0]! / next[2]!).toBeCloseTo(0.6 / 0.4);
    expect(sum(next)).toBeCloseTo(1);
  });

  it('a pane dropped on a divider and one at a window edge get an equal share too', () => {
    const two = splitGroup(g('a'), 'a', 'right', 'b', 0.5, 's1');
    for (const s of (insertAtDivider(two, 's1', 0, 'n') as { sizes: number[] }).sizes) expect(s).toBeCloseTo(1 / 3);
    for (const s of (splitRoot(two, 'left', 'n') as { sizes: number[] }).sizes) expect(s).toBeCloseTo(1 / 3);
  });
});
