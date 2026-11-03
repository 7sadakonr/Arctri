import { useEffect, useRef, useState } from 'react';
import { useLayout } from '@/stores/layout';
import { dropTargetAt, sameTarget, TAB_MIME, useDrag, type DividerGeo, type Geo, type GroupGeo, type Rect } from './dnd';
import { DropCompass } from './DropCompass';
import { DropHighlight } from './DropHighlight';

const rel = (r: DOMRect, o: DOMRect): Rect => ({ x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height });

/** Measures the grid once when a drag starts (nothing moves while a tab is being dragged). */
function measure(root: HTMLElement): Geo {
  const o = root.getBoundingClientRect();
  const groups: GroupGeo[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-group]')) {
    const strip = el.querySelector<HTMLElement>('[data-group-strip]');
    const body = el.querySelector<HTMLElement>('[data-group-body]');
    if (!strip || !body) continue;
    const s = strip.getBoundingClientRect();
    if (s.width === 0) continue; // a group hidden behind a zoomed one
    const tabs = [...strip.querySelectorAll<HTMLElement>('[data-tab-index]')].map((tab) => {
      const r = tab.getBoundingClientRect();
      return { index: Number(tab.dataset['tabIndex']), x: r.x - o.x, w: r.width };
    });
    groups.push({ id: el.dataset['group']!, rect: rel(el.getBoundingClientRect(), o), strip: rel(s, o), body: rel(body.getBoundingClientRect(), o), tabs });
  }
  const dividers: DividerGeo[] = [...root.querySelectorAll<HTMLElement>('[data-divider]')].map((el) => ({
    splitId: el.dataset['splitId']!,
    index: Number(el.dataset['index']),
    dir: el.dataset['dir'] === 'col' ? 'col' : 'row',
    rect: rel(el.getBoundingClientRect(), o),
    adjacent: (el.dataset['adjacent'] ?? '').split(',').filter(Boolean),
    before: el.dataset['before'] ?? '',
    after: el.dataset['after'] ?? ''
  }));
  const top = useLayout.getState().root;
  const leaf = (n: { type: string; id: string } | undefined) => (n?.type === 'group' ? n.id : '');
  const rootInfo: NonNullable<Geo['rootInfo']> =
    top?.type === 'split'
      ? { single: false, dir: top.dir, first: leaf(top.children[0]), last: leaf(top.children[top.children.length - 1]) }
      : { single: true, first: '', last: '' };
  return { workspace: { x: 0, y: 0, w: o.width, h: o.height }, groups, dividers, rootInfo };
}

/**
 * Covers the workspace while a tab is dragged and is the only thing that takes the drag events (so terminals and editors
 * never see them): it works out the drop target for the pointer, shows it in one highlight and carries out the drop.
 */
export function DragLayer({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const dragKey = useDrag((s) => s.key);
  const geoRef = useRef<Geo | undefined>(undefined);
  const [geo, setGeo] = useState<Geo | undefined>(undefined);

  useEffect(() => {
    if (!dragKey || !root.current) {
      geoRef.current = undefined;
      setGeo(undefined);
      return;
    }
    geoRef.current = measure(root.current);
    setGeo(geoRef.current);
  }, [dragKey]);

  if (!dragKey || !geo) return null;

  const compute = (e: React.DragEvent<HTMLDivElement>) => {
    const o = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - o.x, y: e.clientY - o.y };
    const { info, target: prev } = useDrag.getState();
    const next = info && geoRef.current ? dropTargetAt(p, geoRef.current, prev, info) : undefined;
    if (!sameTarget(prev, next)) useDrag.getState().setTarget(next, p);
    // the compass follows the pane the pointer is over (also while it is on one of the compass's own buttons)
    useDrag.getState().setHover(geoRef.current?.groups.find((g) => p.x >= g.rect.x && p.x <= g.rect.x + g.rect.w && p.y >= g.rect.y && p.y <= g.rect.y + g.rect.h)?.id);
    return next;
  };

  return (
    <div
      data-testid="drag-layer"
      className="absolute inset-0 z-50"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_MIME)) return;
        const next = compute(e);
        if (next) e.preventDefault();
        e.dataTransfer.dropEffect = next ? 'move' : 'none';
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) useDrag.getState().setTarget(undefined);
      }}
      onDrop={(e) => {
        const key = e.dataTransfer.getData(TAB_MIME);
        e.preventDefault();
        const t = compute(e);
        useDrag.getState().end();
        if (!key || !t) return;
        useLayout.getState().applyDrop(key, t);
      }}
    >
      <DropHighlight geo={geo} />
      <DropCompass geo={geo} />
    </div>
  );
}
