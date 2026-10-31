import { Merge, PanelBottom, PanelLeft, PanelRight, PanelTop, Rows2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/stores/layout';
import { slotRect, ZONE_LABEL, useDrag, type DropTarget, type Geo, type Rect } from './dnd';
import { applyDrop, groupOf } from './model';
import { layoutRects } from './tree';

const ICON = { left: PanelLeft, right: PanelRight, top: PanelTop, bottom: PanelBottom, center: Merge } as const;
const INSET = 2;

function describe(target: DropTarget): { icon: React.ComponentType<{ size?: number }>; label: MessageKey; whole?: boolean } {
  if (target.kind === 'root') return { icon: ICON[target.edge], label: ZONE_LABEL[target.edge], whole: true };
  if (target.kind === 'pane') return { icon: ICON[target.zone], label: target.small ? 'drop.tooSmall' : ZONE_LABEL[target.zone] };
  if (target.kind === 'strip') return { icon: ICON.center, label: ZONE_LABEL.center };
  return { icon: Rows2, label: 'drop.between' };
}

const inset = (r: Rect, n: number): Rect => ({ x: r.x + n, y: r.y + n, w: Math.max(0, r.w - 2 * n), h: Math.max(0, r.h - 2 * n) });

/** The area the tab would get: the pane that would appear for a split, or the pane it would join. */
function footprint(target: DropTarget, key: string, geo: Geo): { frame: Rect; slot?: Rect } | undefined {
  if (target.kind === 'strip' || (target.kind === 'pane' && target.zone === 'center')) {
    const g = geo.groups.find((x) => x.id === target.groupId);
    if (!g) return undefined;
    return { frame: inset(g.rect, INSET), ...(target.kind === 'strip' ? { slot: slotRect(g, target.index) } : {}) };
  }
  // a new pane: what it is after the drop is worked out by doing the drop on a copy of the layout
  const now = useLayout.getState();
  const next = applyDrop({ root: now.root, groups: now.groups, tabs: now.tabs, focused: now.focused, zoomed: undefined }, key, target);
  const dest = groupOf(next, key)?.id;
  const rect = dest ? layoutRects(next.root, geo.workspace)[dest] : undefined;
  return rect ? { frame: inset(rect, INSET) } : undefined;
}

/**
 * The one highlight that follows the pointer while a tab is dragged. It covers the area the tab would get (a new pane for a
 * split, the pane it would join otherwise) and says in words what dropping does. It flows from one target to the next and
 * grows out of the pointer when it first appears.
 */
export function DropHighlight({ geo }: { geo: Geo }) {
  const t = useT();
  const key = useDrag((s) => s.key);
  const target = useDrag((s) => s.target);
  const point = useDrag((s) => s.point);
  const [box, setBox] = useState<Rect | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const pointRef = useRef(point);
  pointRef.current = point;
  const was = useRef(false);
  const targetKey = target ? JSON.stringify(target) : '';

  const plan = useMemo(() => (key && target ? footprint(target, key, geo) : undefined), [key, targetKey, geo]);
  const want = plan?.frame;
  const wantKey = want ? `${want.x}|${want.y}|${want.w}|${want.h}` : '';

  useEffect(() => {
    if (!want) {
      was.current = false;
      setShown(false);
      return;
    }
    if (!was.current) {
      // first appearance: a small chip under the pointer, then it opens out to the target
      was.current = true;
      setBox({ x: pointRef.current.x - 12, y: pointRef.current.y - 12, w: 24, h: 24 });
      setShown(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setBox(want)));
      return () => cancelAnimationFrame(raf);
    }
    setBox(want);
  }, [wantKey]);

  if (!box || !target) return null;
  const d = describe(target);
  const Icon = d.icon;
  const outlineOnly = target.kind === 'strip'; // the tab goes into the strip, so only the pane it joins is outlined
  const slot = plan?.slot;
  return (
    <>
      <div
        data-testid="drop-highlight"
        data-target={targetKey}
        className="ad-drop-preview pointer-events-none absolute flex flex-col items-center justify-end overflow-hidden pb-3"
        style={{
          left: box.x, top: box.y, width: box.w, height: box.h, opacity: shown ? 1 : 0, borderRadius: 'var(--ad-radius-lg)',
          // plain: a soft tint and a ring; what is behind it is blurred (the compass above stays sharp)
          background: outlineOnly ? 'transparent' : 'color-mix(in srgb, var(--ad-accent) 9%, transparent)',
          boxShadow: 'inset 0 0 0 1.5px var(--ad-drop-ring)',
          backdropFilter: outlineOnly ? undefined : 'blur(6px)'
        }}
      >
        {box.w > 120 && box.h > 60 && (
          <>
            <span
              className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 text-[11px] font-medium text-fg"
              style={{ boxShadow: 'var(--ad-shadow-float)' }}
            >
              <Icon size={13} />
              {t(d.label)}
              {d.whole && <span className="text-fg-muted">· {t('drop.wholeWindow')}</span>}
              <span className="font-mono text-[10px] text-fg-muted">{Math.round(box.w)} × {Math.round(box.h)}</span>
            </span>
          </>
        )}
      </div>
      {slot && (
        <div
          data-testid="drop-slot"
          className="ad-drop-preview pointer-events-none absolute"
          style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h, borderRadius: 999, background: 'var(--ad-drop-ring)', boxShadow: 'var(--ad-shadow-float)' }}
        />
      )}
    </>
  );
}
