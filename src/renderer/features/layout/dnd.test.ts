import { describe, expect, it } from 'vitest';
import { dropTargetAt, compassRects, MIN_SPLIT, rootButtonRects, slotRect, zoneAt, type DragInfo, type Geo } from './dnd';

describe('zoneAt', () => {
  it('picks the edge the pointer is closest to, within the outer quarter', () => {
    expect(zoneAt(10, 200, 800, 400)).toBe('left');
    expect(zoneAt(790, 200, 800, 400)).toBe('right');
    expect(zoneAt(400, 10, 800, 400)).toBe('top');
    expect(zoneAt(400, 390, 800, 400)).toBe('bottom');
  });
  it('the middle is "into this group", and a corner goes to the nearer edge', () => {
    expect(zoneAt(400, 200, 800, 400)).toBe('center');
    expect(zoneAt(5, 60, 800, 400)).toBe('left');
  });
});

// two columns side by side: a (x 0..400) and b (400..800), strips 36px high, workspace 800x500
const geo: Geo = {
  workspace: { x: 0, y: 0, w: 800, h: 500 },
  groups: [
    { id: 'a', rect: { x: 0, y: 0, w: 400, h: 500 }, strip: { x: 0, y: 0, w: 400, h: 36 }, body: { x: 0, y: 36, w: 400, h: 464 }, tabs: [{ index: 0, x: 0, w: 120 }, { index: 1, x: 120, w: 120 }] },
    { id: 'b', rect: { x: 400, y: 0, w: 400, h: 500 }, strip: { x: 400, y: 0, w: 400, h: 36 }, body: { x: 400, y: 36, w: 400, h: 464 }, tabs: [{ index: 0, x: 400, w: 120 }] }
  ],
  dividers: [{ splitId: 's1', index: 0, dir: 'row', rect: { x: 400, y: 0, w: 1, h: 500 }, adjacent: ['a', 'b'], before: 'a', after: 'b' }],
  rootInfo: { single: false, dir: 'row', first: 'a', last: 'b' }
};
const drag = (over: Partial<DragInfo> = {}): DragInfo => ({ key: 's:x', sourceGroup: 'a', sourceAlone: false, groupCount: 2, ...over });

describe('dropTargetAt', () => {
  it('in a tab strip it inserts before / between / after the tabs', () => {
    expect(dropTargetAt({ x: 30, y: 18 }, geo, undefined, drag())).toEqual({ kind: 'strip', groupId: 'a', index: 0 });
    expect(dropTargetAt({ x: 150, y: 18 }, geo, undefined, drag())).toEqual({ kind: 'strip', groupId: 'a', index: 1 });
    expect(dropTargetAt({ x: 370, y: 18 }, geo, undefined, drag())).toEqual({ kind: 'strip', groupId: 'a', index: 2 });
  });

  it('along the outer bottom edge it is "whole window", under both columns', () => {
    expect(dropTargetAt({ x: 200, y: 490 }, geo, undefined, drag())).toEqual({ kind: 'root', edge: 'bottom' });
    expect(dropTargetAt({ x: 600, y: 485 }, geo, undefined, drag())).toEqual({ kind: 'root', edge: 'bottom' });
    expect(dropTargetAt({ x: 4, y: 250 }, geo, undefined, drag())).toEqual({ kind: 'root', edge: 'left' });
    expect(dropTargetAt({ x: 797, y: 250 }, geo, undefined, drag())).toEqual({ kind: 'root', edge: 'right' });
  });

  it('inside a pane it is a side of that pane or "into" it', () => {
    expect(dropTargetAt({ x: 200, y: 250 }, geo, undefined, drag())).toEqual({ kind: 'pane', groupId: 'a', zone: 'center' });
    expect(dropTargetAt({ x: 600, y: 120 }, geo, undefined, drag())).toEqual({ kind: 'pane', groupId: 'b', zone: 'top' });
    expect(dropTargetAt({ x: 200, y: 250 }, geo, undefined, drag())).toEqual({ kind: 'pane', groupId: 'a', zone: 'center' });
    expect(dropTargetAt({ x: 200, y: 120 }, geo, undefined, drag())).toEqual({ kind: 'pane', groupId: 'a', zone: 'top' });
  });

  it('keeps the zone until the pointer is clearly past the border (no flicker)', () => {
    // the middle of A's body spans x 120..280 (40 %, at least 120 px); the left half of A is the window's left edge
    const left = { kind: 'root', edge: 'left' } as const;
    const middle = { kind: 'pane', groupId: 'a', zone: 'center' } as const;
    expect(dropTargetAt({ x: 115, y: 268 }, geo, undefined, drag())).toEqual(left);
    expect(dropTargetAt({ x: 115, y: 268 }, geo, middle, drag())).toEqual(middle); // came from the middle: stays a little longer
    expect(dropTargetAt({ x: 125, y: 268 }, geo, undefined, drag())).toEqual(middle);
    expect(dropTargetAt({ x: 125, y: 268 }, geo, left, drag())).toEqual(left); // came from the left: stays a little longer
    expect(dropTargetAt({ x: 60, y: 268 }, geo, middle, drag())).toEqual(left); // clearly in the left half
  });

  it('the only tab of a group cannot be split off onto its own pane', () => {
    const t = dropTargetAt({ x: 410, y: 250 }, geo, undefined, drag({ sourceGroup: 'b', sourceAlone: true }));
    expect(t).toEqual({ kind: 'pane', groupId: 'b', zone: 'center' });
  });

  it('there is no whole-window edge when the only tab of the only group is dragged', () => {
    const one: Geo = { workspace: geo.workspace, groups: [geo.groups[0]!] };
    const t = dropTargetAt({ x: 200, y: 495 }, one, undefined, drag({ sourceAlone: true, groupCount: 1 }));
    expect(t?.kind).toBe('pane');
  });

  it('nothing outside the workspace', () => {
    expect(dropTargetAt({ x: -5, y: 100 }, geo, undefined, drag())).toBeUndefined();
  });
});

describe('hit areas', () => {
  it('a pane is cut by its diagonals into four halves, with a middle box that joins', () => {
    // a 400 x 400 pane: the middle is 160 x 160
    expect(zoneAt(100, 200, 400, 400)).toBe('left');
    expect(zoneAt(300, 200, 400, 400)).toBe('right');
    expect(zoneAt(200, 60, 400, 400)).toBe('top');
    expect(zoneAt(200, 340, 400, 400)).toBe('bottom');
    expect(zoneAt(200, 200, 400, 400)).toBe('center');
    // a corner goes to the nearer half (the diagonal)
    expect(zoneAt(80, 30, 400, 400)).toBe('top');
    expect(zoneAt(30, 80, 400, 400)).toBe('left');
  });
  it('the middle is never smaller than 120 x 80, nor bigger than 60 % of the pane', () => {
    expect(zoneAt(50 + 5, 150, 220, 300)).toBe('center'); // 220 wide: the middle is 120 wide, x 50..170
    expect(zoneAt(50 - 5, 150, 220, 300)).toBe('left');
    expect(zoneAt(0.2 * 1000, 500, 1000, 1000)).toBe('left'); // 1000 wide: 40 % is 400, x 300..700
    expect(zoneAt(0.3 * 1000 + 5, 500, 1000, 1000)).toBe('center');
  });
  it('a pane that is too small for the half it would give is not split: it joins the tabs, and says why', () => {
    const narrow: Geo = {
      workspace: geo.workspace,
      groups: [{ id: 'n', rect: { x: 0, y: 0, w: 2 * MIN_SPLIT.w - 20, h: 500 }, strip: { x: 0, y: 0, w: 300, h: 36 }, body: { x: 0, y: 36, w: 2 * MIN_SPLIT.w - 20, h: 464 }, tabs: [] }],
      rootInfo: { single: true, first: '', last: '' }
    };
    expect(dropTargetAt({ x: 20, y: 268 }, narrow, undefined, drag({ groupCount: 1 }))).toEqual({ kind: 'pane', groupId: 'n', zone: 'center', small: true });
  });
  it('the whole-window edge reaches 48px in, and the top rim 14px', () => {
    expect(dropTargetAt({ x: 300, y: 500 - 45 }, geo, undefined, drag())).toEqual({ kind: 'root', edge: 'bottom' });
    expect(dropTargetAt({ x: 300, y: 500 - 60 }, geo, undefined, drag())?.kind).toBe('pane');
  });
  it('a tab strip also takes a drop a little below it', () => {
    expect(dropTargetAt({ x: 200, y: 36 + 6 }, geo, undefined, drag())).toEqual({ kind: 'strip', groupId: 'a', index: 2 });
    expect(dropTargetAt({ x: 200, y: 36 + 12 }, geo, undefined, drag())?.kind).toBe('pane');
  });
});

describe('dividers', () => {
  it('on the line between two panes it is a new pane the full length of the line', () => {
    expect(dropTargetAt({ x: 402, y: 250 }, geo, undefined, drag())).toEqual({ kind: 'divider', splitId: 's1', index: 0 });
    expect(dropTargetAt({ x: 390, y: 250 }, geo, undefined, drag())).toEqual({ kind: 'divider', splitId: 's1', index: 0 }); // 14px each side
    expect(dropTargetAt({ x: 412, y: 250 }, geo, undefined, drag())).toEqual({ kind: 'divider', splitId: 's1', index: 0 });
  });
  it('also along the tab strips (the line wins over the strip there)', () => {
    expect(dropTargetAt({ x: 401, y: 18 }, geo, undefined, drag())).toEqual({ kind: 'divider', splitId: 's1', index: 0 });
  });
  it('not beside the only tab of a pane that touches it (it would stay where it is)', () => {
    const t = dropTargetAt({ x: 402, y: 250 }, geo, undefined, drag({ sourceGroup: 'a', sourceAlone: true }));
    expect(t?.kind).toBe('pane');
  });
  it('further from the line, still inside B\'s side zone, it is the same divider (no second zone for the same layout)', () => {
    expect(dropTargetAt({ x: 430, y: 250 }, geo, undefined, drag())).toEqual({ kind: 'divider', splitId: 's1', index: 0 });
  });
});

describe('slotRect', () => {
  it('is a slim capsule before a tab, between tabs and after the last one', () => {
    expect(slotRect(geo.groups[0]!, 0)).toEqual({ x: -2, y: 5, w: 4, h: 26 });
    expect(slotRect(geo.groups[0]!, 1).x).toBe(118);
    expect(slotRect(geo.groups[0]!, 2).x).toBe(238); // after the last tab: its right edge
  });
});

describe('one zone per layout', () => {
  const bs = drag();
  const D = { kind: 'divider', splitId: 's1', index: 0 } as const;
  it('[A | B]: the right of A, the line, and the left of B are all the same divider', () => {
    expect(dropTargetAt({ x: 350, y: 250 }, geo, undefined, bs)).toEqual(D); // A's right side zone
    expect(dropTargetAt({ x: 400, y: 250 }, geo, undefined, bs)).toEqual(D);
    expect(dropTargetAt({ x: 440, y: 250 }, geo, undefined, bs)).toEqual(D); // B's left side zone
  });
  it('the left of A and the window rim are the same root edge, as are the right of B and its rim', () => {
    expect(dropTargetAt({ x: 60, y: 250 }, geo, undefined, bs)).toEqual({ kind: 'root', edge: 'left' });
    expect(dropTargetAt({ x: 5, y: 250 }, geo, undefined, bs)).toEqual({ kind: 'root', edge: 'left' });
    expect(dropTargetAt({ x: 760, y: 250 }, geo, undefined, bs)).toEqual({ kind: 'root', edge: 'right' });
  });
  it('the top and bottom of one pane still split only that pane; the rim at the bottom spans the window', () => {
    expect(dropTargetAt({ x: 200, y: 400 }, geo, undefined, bs)).toEqual({ kind: 'pane', groupId: 'a', zone: 'bottom' });
    expect(dropTargetAt({ x: 200, y: 490 }, geo, undefined, bs)).toEqual({ kind: 'root', edge: 'bottom' });
  });
  it('one pane: no window rim of its own, its sides are the pane\'s sides', () => {
    const one: Geo = { workspace: geo.workspace, groups: [{ ...geo.groups[0]!, rect: { x: 0, y: 0, w: 800, h: 500 }, body: { x: 0, y: 36, w: 800, h: 464 } }], rootInfo: { single: true, first: '', last: '' } };
    expect(dropTargetAt({ x: 10, y: 250 }, one, undefined, drag({ groupCount: 1 }))).toEqual({ kind: 'pane', groupId: 'a', zone: 'left' });
    expect(dropTargetAt({ x: 400, y: 495 }, one, undefined, drag({ groupCount: 1 }))).toEqual({ kind: 'pane', groupId: 'a', zone: 'bottom' });
  });
  it('a nested split keeps the pane zone where splitting only that pane differs from the divider', () => {
    // [A | (B / C)]: B is in a column, so B's left side splits B only, while A's right side is the divider with the whole column
    const nested: Geo = {
      workspace: geo.workspace,
      groups: [
        geo.groups[0]!,
        { id: 'b', rect: { x: 400, y: 0, w: 400, h: 250 }, strip: { x: 400, y: 0, w: 400, h: 36 }, body: { x: 400, y: 36, w: 400, h: 214 }, tabs: [{ index: 0, x: 400, w: 120 }] }
      ],
      dividers: [{ splitId: 's1', index: 0, dir: 'row', rect: { x: 400, y: 0, w: 1, h: 500 }, adjacent: ['a', 'b', 'c'], before: 'a', after: '' }],
      rootInfo: { single: false, dir: 'row', first: 'a', last: '' }
    };
    expect(dropTargetAt({ x: 440, y: 150 }, nested, undefined, drag())).toEqual({ kind: 'pane', groupId: 'b', zone: 'left' });
    expect(dropTargetAt({ x: 350, y: 250 }, nested, undefined, drag())).toEqual({ kind: 'divider', splitId: 's1', index: 0 });
  });
});

describe('compass', () => {
  it('is a cross of five round buttons in the middle of the pane, apart from each other', () => {
    const c = compassRects(geo.groups[0]!.body);
    const mid = geo.groups[0]!.body.x + geo.groups[0]!.body.w / 2;
    expect(c.center.x + c.center.w / 2).toBeCloseTo(mid);
    expect(c.left.x + c.left.w).toBeLessThan(c.center.x);
    expect(c.right.x).toBeGreaterThan(c.center.x + c.center.w);
    expect(c.top.y + c.top.h).toBeLessThan(c.center.y);
    expect(c.bottom.y).toBeGreaterThan(c.center.y + c.center.h);
    expect(c.center.w).toBe(36);
  });
  it('gets smaller in a small pane', () => {
    expect(compassRects({ x: 0, y: 0, w: 150, h: 300 }).center.w).toBe(28);
  });
  it('the middle button joins as a tab, even where the side zones would say otherwise', () => {
    const c = compassRects(geo.groups[0]!.body);
    const p = { x: c.center.x + 18, y: c.center.y + 18 };
    expect(dropTargetAt(p, geo, undefined, drag())).toEqual({ kind: 'pane', groupId: 'a', zone: 'center' });
  });
  it('the right button of A is the divider between A and B; the left one the window\'s left edge', () => {
    const c = compassRects(geo.groups[0]!.body);
    expect(dropTargetAt({ x: c.right.x + 18, y: c.right.y + 18 }, geo, undefined, drag())).toEqual({ kind: 'divider', splitId: 's1', index: 0 });
    expect(dropTargetAt({ x: c.left.x + 18, y: c.left.y + 18 }, geo, undefined, drag())).toEqual({ kind: 'root', edge: 'left' });
    expect(dropTargetAt({ x: c.bottom.x + 18, y: c.bottom.y + 18 }, geo, undefined, drag())).toEqual({ kind: 'pane', groupId: 'a', zone: 'bottom' });
  });
  it('the pane the only tab comes from only has the middle button', () => {
    const c = compassRects(geo.groups[0]!.body);
    const own = drag({ sourceGroup: 'a', sourceAlone: true });
    expect(dropTargetAt({ x: c.right.x + 18, y: c.right.y + 18 }, geo, undefined, own)).toEqual({ kind: 'pane', groupId: 'a', zone: 'center' });
  });
});

describe('buttons on the window\'s edges', () => {
  it('pointing at the one in the middle of the bottom edge is a pane across the whole window', () => {
    const b = rootButtonRects(geo.workspace).bottom;
    expect(dropTargetAt({ x: b.x + 14, y: b.y + 14 }, geo, undefined, drag())).toEqual({ kind: 'root', edge: 'bottom' });
    // right on the line between the panes, where the divider zone would win otherwise
    expect(b.x + b.w / 2).toBe(400);
  });
  it('there are none with a single pane', () => {
    const one: Geo = { workspace: geo.workspace, groups: [geo.groups[0]!], rootInfo: { single: true, first: '', last: '' } };
    const b = rootButtonRects(one.workspace).bottom;
    expect(dropTargetAt({ x: b.x + 14, y: b.y + 14 }, one, undefined, drag({ groupCount: 1 }))?.kind).not.toBe('root');
  });
});
