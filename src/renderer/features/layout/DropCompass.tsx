import { Layers, PanelBottom, PanelLeft, PanelRight, PanelTop } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { canonicalSide, compassRects, rootButtonRects, sameTarget, useDrag, type DropTarget, type Geo, type Rect } from './dnd';
import type { MessageKey } from '@shared/i18n';
import type { Edge } from './tree';

const ICON = { left: PanelLeft, right: PanelRight, top: PanelTop, bottom: PanelBottom, center: Layers } as const;
const LABEL: Record<keyof typeof ICON, MessageKey> = { left: 'drop.left', right: 'drop.right', top: 'drop.top', bottom: 'drop.bottom', center: 'drop.into' };
const ZONES = ['top', 'left', 'center', 'right', 'bottom'] as const;

/** One round button: quiet until the zone it stands for is the one aimed at, then it fills with the accent colour. */
function Button({ rect, icon: Icon, active, label, small }: { rect: Rect; icon: React.ComponentType<{ size?: number }>; active: boolean; label: string; small?: boolean }) {
  return (
    <div
      role="presentation"
      title={label}
      data-active={active}
      className={cn(
        'ad-compass-button absolute flex items-center justify-center border',
        active ? 'border-transparent bg-accent text-accent-fg' : 'border-border-strong bg-surface/80 text-fg-muted backdrop-blur'
      )}
      style={{
        left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: 'var(--ad-radius)',
        boxShadow: 'var(--ad-shadow-float)', transform: active ? 'scale(1.1)' : undefined
      }}
    >
      <Icon size={small ? 13 : 16} />
    </div>
  );
}

/** A line along the middle of a window edge: faint until aimed at, then it stretches and glows. */
function EdgeBar({ edge, rect, active, label }: { edge: Edge; rect: Rect; active: boolean; label: string }) {
  const horizontal = edge === 'top' || edge === 'bottom';
  const long = active ? 1 : 0.55;
  return (
    <div data-testid="drop-edge-button" data-edge={edge} data-active={active} title={label} className="absolute" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <span
        className="ad-compass-bar absolute rounded-full bg-accent"
        style={{
          [edge]: 5,
          opacity: active ? 0.95 : 0.4,
          boxShadow: active ? '0 0 14px 2px color-mix(in srgb, var(--ad-accent) 55%, transparent)' : undefined,
          ...(horizontal
            ? { left: '50%', width: `${Math.round(long * 100)}%`, height: 4, transform: `translateX(-50%) scaleX(${active ? 1.6 : 1})` }
            : { top: '50%', height: `${Math.round(long * 100)}%`, width: 4, transform: `translateY(-50%) scaleY(${active ? 1.6 : 1})` })
        }}
      />
    </div>
  );
}

/**
 * The only guide on screen while a tab is dragged: five round buttons in a cross in the middle of the pane the pointer is over
 * (the four sides split, the middle joins as a tab) and a line in the middle of each edge of the window (a pane across the
 * whole width or height). Point at a button, or just aim at the side of the pane: the button of that zone fills in either way.
 */
export function DropCompass({ geo }: { geo: Geo }) {
  const t = useT();
  const info = useDrag((s) => s.info);
  const target = useDrag((s) => s.target);
  const hover = useDrag((s) => s.hover);
  if (!info) return null;
  const group = geo.groups.find((g) => g.id === hover);
  const rects = group ? compassRects(group.body) : undefined;
  const own = !!group && info.sourceAlone && info.sourceGroup === group.id; // its only tab cannot be split off itself
  const edges = !(geo.rootInfo?.single ?? info.groupCount === 1) ? rootButtonRects(geo.workspace) : undefined;
  const small = !!group && (group.body.w < 160 || group.body.h < 160);
  const targetOf = (z: (typeof ZONES)[number]): DropTarget =>
    z === 'center' ? { kind: 'pane', groupId: group!.id, zone: 'center' } : canonicalSide(group!.id, z, geo, info);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="drop-compass-layer">
      {group && rects && (
        <div key={group.id} data-testid="drop-compass" data-group={group.id} className="ad-enter-pop">
          {ZONES.filter((z) => !(own && z !== 'center')).map((z) => (
            <Button key={z} rect={rects[z]} icon={ICON[z]} label={t(LABEL[z])} active={sameTarget(targetOf(z), target)} {...(small ? { small } : {})} />
          ))}
        </div>
      )}
      {edges &&
        (['left', 'right', 'top', 'bottom'] as Edge[]).map((edge) => (
          <EdgeBar key={edge} edge={edge} rect={edges[edge]} active={target?.kind === 'root' && target.edge === edge} label={`${t(LABEL[edge])} · ${t('drop.wholeWindow')}`} />
        ))}
    </div>
  );
}
