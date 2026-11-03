import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useLayout } from '@/stores/layout';
import { useSessions } from '@/stores/sessions';
import { SessionView } from '../terminal/SessionView';
import { FileTabView } from '../viewer/FileTabView';
import { useDrag, useDragCleanup } from './dnd';
import { DragLayer } from './DragLayer';
import { GroupTabBar } from './GroupTabBar';
import { dragDivider, groupIds, type Node, type SplitNode } from './tree';

function SessionTab({ sessionId, active, focused }: { sessionId: string; active: boolean; focused: boolean }) {
  const info = useSessions((s) => s.infos[sessionId]);
  return info ? <SessionView info={info} active={active} focused={focused} /> : null;
}

function FileTab({ tabKey }: { tabKey: string }) {
  const tab = useLayout((s) => s.tabs[tabKey]);
  const info = useSessions((s) => (tab ? s.infos[tab.sessionId] : undefined));
  return tab?.kind === 'file' && info ? <FileTabView key={tab.key} tab={tab} info={info} /> : null;
}

/** Groups that have been on screen already: one that appears later was just split off and settles in. */
const seenGroups = new Set<string>();

/** One group: its tab strip and the front tab. Terminals of all its session tabs stay mounted (hidden) so they keep running. */
function PaneGroup({ id }: { id: string }) {
  const group = useLayout((s) => s.groups[id]);
  const focused = useLayout((s) => s.focused === id);
  const tabs = useLayout((s) => s.tabs);
  const goingAway = useDrag((s) => !!s.info?.sourceAlone && s.info.sourceGroup === id);
  const isNew = useRef(seenGroups.size > 0 && !seenGroups.has(id));
  seenGroups.add(id);
  if (!group) return null;
  return (
    <div
      data-group={id}
      data-focused={focused}
      className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col transition-opacity duration-150', isNew.current && 'ad-pane-in', goingAway && 'opacity-70')}
      onMouseDownCapture={() => {
        if (!focused) useLayout.getState().focus(id);
      }}
    >
      <GroupTabBar group={group} />
      <div data-group-body={id} className="relative min-h-0 flex-1">
        {group.tabs.map((k) => {
          const tab = tabs[k];
          if (!tab) return null;
          const front = group.active === k;
          if (tab.kind === 'session') return <SessionTab key={k} sessionId={tab.sessionId} active={front} focused={focused} />;
          if (!front) return null;
          return (
            <div key={k} className="absolute inset-0">
              <FileTab tabKey={k} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Divider({ node, index, box }: { node: SplitNode; index: number; box: React.RefObject<HTMLDivElement | null> }) {
  const start = useRef<{ pos: number; sizes: number[]; total: number } | undefined>(undefined);
  const row = node.dir === 'row';
  return (
    <div
      role="separator"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      data-testid="pane-divider"
      data-divider
      data-split-id={node.id}
      data-index={index}
      data-dir={node.dir}
      data-before={node.children[index]!.type === 'group' ? node.children[index]!.id : ''}
      data-after={node.children[index + 1]!.type === 'group' ? node.children[index + 1]!.id : ''}
      data-adjacent={[...groupIds(node.children[index]), ...groupIds(node.children[index + 1])].join(',')}
      className={cn(
        'relative z-10 shrink-0 bg-border hover:bg-accent/60',
        row ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = box.current?.getBoundingClientRect();
        start.current = { pos: row ? e.clientX : e.clientY, sizes: node.sizes, total: (row ? r?.width : r?.height) ?? 1 };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const delta = ((row ? e.clientX : e.clientY) - s.pos) / s.total;
        useLayout.getState().setSizes(node.id, dragDivider(s.sizes, index, delta));
      }}
      onPointerUp={() => (start.current = undefined)}
      onDoubleClick={() => useLayout.getState().setSizes(node.id, node.sizes.map(() => 1 / node.sizes.length))}
    >
      {/* a wider target than the one-pixel line, with a small rounded grip that shows on hover */}
      <div className={cn('group absolute', row ? 'inset-y-0 -left-1 w-2' : 'inset-x-0 -top-1 h-2')}>
        <span
          className={cn(
            'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg/0 transition-colors group-hover:bg-fg/40',
            row ? 'h-9 w-[3px]' : 'h-[3px] w-9'
          )}
        />
      </div>
    </div>
  );
}

function containsGroup(node: Node, id: string | undefined): boolean {
  return !!id && groupIds(node).includes(id);
}

function NodeView({ node, zoomed }: { node: Node; zoomed: string | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  if (node.type === 'group') return <PaneGroup id={node.id} />;
  const items: ReactNode[] = [];
  node.children.forEach((child, i) => {
    // a zoomed group fills the workspace; the others stay mounted (their terminals keep running), just out of sight
    const hide = !!zoomed && !containsGroup(child, zoomed);
    items.push(
      <div key={child.id} className="flex" style={hide ? { display: 'none' } : { flex: `${node.sizes[i]} 1 0%`, minWidth: 0, minHeight: 0 }}>
        <NodeView node={child} zoomed={zoomed} />
      </div>
    );
    if (!zoomed && i < node.children.length - 1) items.push(<Divider key={`divider-${child.id}`} node={node} index={i} box={box} />);
  });
  return (
    <div ref={box} className={cn('flex min-h-0 min-w-0 flex-1', node.dir === 'row' ? 'flex-row' : 'flex-col')}>
      {items}
    </div>
  );
}

/** The grid of the window: splits, resizable at their dividers, with a tabbed group in every cell. */
export function Workspace() {
  const root = useLayout((s) => s.root);
  const zoomed = useLayout((s) => s.zoomed);
  const box = useRef<HTMLDivElement>(null);
  useDragCleanup();
  if (!root) return null;
  return (
    <div ref={box} data-testid="workspace" className="relative flex h-full min-h-0 min-w-0">
      <NodeView node={root} zoomed={zoomed} />
      <DragLayer root={box} />
    </div>
  );
}
