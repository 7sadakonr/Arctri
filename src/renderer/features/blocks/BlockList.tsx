import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { tNow, useT } from '@/lib/i18n';
import { useBlocks } from '@/stores/blocks';
import { useUi } from '@/stores/ui';

import { BlockCard } from './BlockCard';

const EMPTY: never[] = [];

export function BlockList({ sessionId, active }: { sessionId: string; active: boolean }) {
  const blocks = useBlocks((s) => s.blocks[sessionId]) ?? EMPTY;
  const selected = useBlocks((s) => s.selected[sessionId]);
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [blocks.length, blocks[blocks.length - 1]?.endedAt]);

  const rerun = useCallback(
    async (command: string) => {
      const res = await api.sessions.submit(sessionId, command);
      if (!res.ok) useUi.getState().toast(tNow('editor.notReady'), 'error');
    },
    [sessionId]
  );

  // Ctrl+Up / Ctrl+Down move the selection between blocks.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const list = useBlocks.getState().blocks[sessionId] ?? [];
      if (list.length === 0) return;
      e.preventDefault();
      const cur = list.findIndex((b) => b.id === useBlocks.getState().selected[sessionId]);
      const next = e.key === 'ArrowUp' ? (cur <= 0 ? (cur === -1 ? list.length - 1 : 0) : cur - 1) : Math.min(list.length - 1, cur + 1);
      const id = list[next]!.id;
      useBlocks.getState().select(sessionId, id);
      stick.current = next === list.length - 1;
      scroller.current?.querySelector(`[data-block-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, sessionId]);

  return (
    <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overflow-x-hidden py-2">
      {blocks.length === 0 && <div className="mx-6 mt-8 text-center text-[12px] text-fg-muted">{t('editor.placeholder')}</div>}
      {blocks.map((b) => (
        <BlockCard
          key={b.id}
          block={b}
          selected={selected === b.id}
          onSelect={() => useBlocks.getState().select(sessionId, b.id)}
          onToggle={() => useBlocks.getState().toggleCollapsed(sessionId, b.id)}
          onRerun={() => void rerun(b.command)}
          onCopied={() => useUi.getState().toast(tNow('block.copied'))}
        />
      ))}
    </div>
  );
}
