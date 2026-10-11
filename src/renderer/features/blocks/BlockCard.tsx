import { ChevronDown, ChevronRight, Copy, CopyPlus, Loader2, RotateCcw } from 'lucide-react';
import { memo } from 'react';
import { blockText, type CommandBlock } from '@shared/types/block';
import { formatDuration } from '@shared/i18n';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/clipboard';
import { useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import { SnapshotView } from './styled-lines';

/** Output with fewer lines than this is always shown in full: folding it away would only hide a few lines. */
export const COLLAPSIBLE_MIN_LINES = 10;

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
  const dark = useUi((s) => s.prefs.theme === 'dark');
  const duration = block.endedAt ? block.endedAt - block.startedAt : undefined;
  const hasOutput = !!block.output && block.output.charCount > 0;
  const collapsible = hasOutput && block.output!.lines.length > COLLAPSIBLE_MIN_LINES;
  const collapsed = collapsible && block.collapsed;
  const failed = block.status === 'failed';
  // The prompt as the shell drew it is the header, provided it really ends with this command (it may not for wrapped multi-line input).
  const first = block.command.split('\n')[0]!.trim();
  const showPrompt = !!block.prompt && blockText(block.prompt).includes(first);

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
      data-status={block.status}
      onMouseDown={onSelect}
      className={cn(
        'group fade-in relative border-b border-border',
        failed && 'bg-danger/10',
        selected && 'ring-1 ring-inset ring-accent/50'
      )}
    >
      {failed && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-danger" />}
      <header className="flex items-start gap-2 px-4 py-2.5">
        {collapsible && (
          <button
            aria-label={collapsed ? t('block.expand') : t('block.collapse')}
            onClick={onToggle}
            className="mt-0.5 shrink-0 text-fg-muted hover:text-fg"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          {showPrompt ? (
            <SnapshotView snapshot={block.prompt!} dark={dark} />
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13px] font-semibold leading-snug">
              {block.cwd && <span className="mr-2 font-normal text-fg-muted">{leaf(block.cwd.path)}</span>}
              {block.command}
            </pre>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-fg-muted">
          {block.status === 'running' && <Loader2 size={13} className="animate-spin text-warn" />}
          {block.exitCode !== undefined && block.exitCode !== 0 && (
            <span className="font-medium text-danger">{t('block.exit', { code: block.exitCode })}</span>
          )}
          {duration !== undefined && <span>{formatDuration(duration)}</span>}
          {block.usedAltScreen && <span>{t('block.interactive')}</span>}
          <div className="hidden gap-0.5 group-hover:flex focus-within:flex">
            {act(t('block.copyCommand'), <Copy size={13} />, () => void copyText(block.command).then(onCopied))}
            {hasOutput && act(t('block.copyOutput'), <CopyPlus size={13} />, () => void copyText(blockText(block.output)).then(onCopied))}
            {act(t('block.rerun'), <RotateCcw size={13} />, onRerun)}
          </div>
        </div>
      </header>
      {!collapsed && hasOutput && (
        <div className="px-4 pb-3">
          {block.output!.truncated && <div className="mb-1 text-[11px] text-warn">{t('block.truncated')}</div>}
          <SnapshotView snapshot={block.output!} dark={dark} />
        </div>
      )}
    </section>
  );
});
