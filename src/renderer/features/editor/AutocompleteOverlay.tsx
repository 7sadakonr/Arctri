import { Braces, File, Folder, GitBranch, GitCommitHorizontal, History, Terminal as TerminalIcon, Package } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CompletionItem } from '@shared/types/completion';
import { cn } from '@/lib/cn';

const ICONS: Record<CompletionItem['kind'], typeof File> = {
  command: TerminalIcon,
  path: File,
  dir: Folder,
  history: History,
  'git-subcommand': GitCommitHorizontal,
  'git-branch': GitBranch,
  script: Package,
  flag: Braces
};

export function AutocompleteOverlay({
  items, selected, onPick
}: { items: CompletionItem[]; selected: number; onPick: (i: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  if (items.length === 0) return null;
  return (
    <div
      ref={list}
      role="listbox"
      className="fade-in absolute bottom-full left-0 z-20 mb-1 max-h-[240px] min-w-[280px] max-w-[min(640px,100%)] overflow-auto rounded-lg border border-border bg-panel p-1 shadow-xl"
    >
      {items.map((it, i) => {
        const Icon = ICONS[it.kind];
        return (
          <div
            key={`${it.kind}:${it.insertText}:${i}`}
            role="option"
            aria-selected={i === selected}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(i);
            }}
            className={cn(
              'flex cursor-default items-center gap-2 rounded-md px-2 py-1 font-mono text-[12px]',
              i === selected ? 'bg-hover text-fg' : 'text-fg-muted'
            )}
          >
            <Icon size={12} className="shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate text-fg">{it.label}</span>
            {it.detail && <span className="max-w-[40%] truncate text-[10px] opacity-70">{it.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}
