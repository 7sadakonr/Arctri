import { Check, ChevronDown, ChevronRight, Copy, CopyPlus, Loader2, RotateCcw, Square, X } from 'lucide-react';
import { memo } from 'react';
import { blockText, type CommandBlock } from '@shared/types/block';
import { formatDuration } from '@shared/i18n';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/clipboard';
import { useLang, useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import { SnapshotView } from './styled-lines';

function StatusIcon({ b }: { b: CommandBlock }) {
  if (b.status === 'running') return <Loader2 size={13} className="animate-spin text-warn" />;
  if (b.status === 'success') return <Check size={13} className="text-ok" />;
  if (b.status === 'interrupted') return <Square size={12} className="text-warn" />;
  if (b.status === 'failed') return <X size={13} className="text-danger" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />;
}

const leaf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

export const BlockCard = memo(function BlockCard({
  block, selected, onSelect, onToggle, onRerun, onCopied
}: {
  block: CommandBlock;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRerun: () => void;
  onCopied: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const dark = useUi((s) => s.prefs.theme === 'dark');
  const duration = block.endedAt ? block.endedAt - block.startedAt : undefined;
  const time = new Date(block.startedAt).toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const env = block.env.kind === 'windows' ? block.shell : `${block.env.distro} · ${block.shell}`;
  const hasOutput = !!block.output && block.output.charCount > 0;

  const act = (label: string, icon: React.ReactNode, fn: () => void) => (
    <Tip label={label} side="bottom">
      <button
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          fn();
        }}
        className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
      >
        {icon}
      </button>
    </Tip>
  );

  return (
    <section
      data-block-id={block.id}
      onMouseDown={onSelect}
      className={cn(
        'group fade-in mx-3 my-1.5 rounded-lg border bg-panel/60 transition-colors',
        selected ? 'border-accent/60' : 'border-border',
        block.status === 'failed' && !selected && 'border-danger/40'
      )}
    >
      <header className="flex items-start gap-2 px-3 py-2">
        <button
          aria-label={block.collapsed ? t('block.expand') : t('block.collapse')}
          onClick={onToggle}
          className="mt-0.5 text-fg-muted hover:text-fg"
        >
          {block.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="mt-0.5">
          <StatusIcon b={block} />
        </div>
        <div className="min-w-0 flex-1">
          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13px] font-semibold leading-snug">{block.command}</pre>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-muted">
            {block.cwd && <span title={block.cwd.path}>{leaf(block.cwd.path)}</span>}
            <span>{env}</span>
            <span>{time}</span>
            {duration !== undefined && <span>{formatDuration(duration)}</span>}
            {block.exitCode !== undefined && block.exitCode !== 0 && (
              <span className="font-medium text-danger">{t('block.exit', { code: block.exitCode })}</span>
            )}
            {block.usedAltScreen && <span>{t('block.interactive')}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {act(t('block.copyCommand'), <Copy size={13} />, () => void copyText(block.command).then(onCopied))}
          {hasOutput && act(t('block.copyOutput'), <CopyPlus size={13} />, () => void copyText(blockText(block.output)).then(onCopied))}
          {act(t('block.rerun'), <RotateCcw size={13} />, onRerun)}
        </div>
      </header>
      {!block.collapsed && hasOutput && (
        <div className="border-t border-border/60 px-3 py-2">
          {block.output!.truncated && <div className="mb-1 text-[11px] text-warn">{t('block.truncated')}</div>}
          <SnapshotView snapshot={block.output!} dark={dark} />
        </div>
      )}
    </section>
  );
});
