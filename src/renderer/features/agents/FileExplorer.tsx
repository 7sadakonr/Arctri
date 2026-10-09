import { ChevronDown, ChevronRight, File as FileIcon, Folder, FolderOpen, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { insertText, refOf } from './insert';
import { useChanges } from './useChanges';

interface Entry {
  name: string;
  isDir: boolean;
}

const statusDot = (s: string) => (s === '??' ? 'bg-ok' : s.includes('D') ? 'bg-danger' : 'bg-warn');

/**
 * A read-only list of the files below the tab's working folder (it cannot go above it). Clicking a file puts its
 * path into the message; nothing is opened or edited here.
 */
export function FileExplorer({ info }: { info: SessionInfo }) {
  const t = useT();
  const sep = info.env.kind === 'windows' ? '\\' : '/';
  const cwd = info.cwd?.path ?? '';
  const [tree, setTree] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const changes = useChanges(info.id, true);

  const changed = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of changes?.files ?? []) m.set(f.path.replace(/\\/g, '/'), f.status);
    return m;
  }, [changes]);

  const load = useCallback(
    async (rel: string) => {
      const entries = await api.files.list(info.id, rel);
      setTree((tr) => ({ ...tr, [rel]: entries }));
    },
    [info.id]
  );

  // a new working folder is a new root
  useEffect(() => {
    setTree({});
    setExpanded(new Set(['']));
    void load('');
  }, [cwd, load]);

  const toggle = (rel: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(rel)) next.delete(rel);
      else {
        next.add(rel);
        if (!tree[rel]) void load(rel);
      }
      return next;
    });
  };

  const match = (name: string) => !filter || name.toLowerCase().includes(filter.toLowerCase());
  const subtreeMatches = (rel: string): boolean =>
    (tree[rel] ?? []).some((e) => match(e.name) || (e.isDir && subtreeMatches(join(rel, e.name))));
  const join = (rel: string, name: string) => (rel ? `${rel}${sep}${name}` : name);

  const rows = (rel: string, depth: number): React.ReactNode =>
    (tree[rel] ?? [])
      .filter((e) => (showHidden || !e.name.startsWith('.')) && (match(e.name) || (e.isDir && subtreeMatches(join(rel, e.name)))))
      .map((e) => {
        const path = join(rel, e.name);
        const open = expanded.has(path) || (!!filter && e.isDir && subtreeMatches(path));
        const status = changed.get(path.replace(/\\/g, '/'));
        return (
          <div key={path}>
            <div
              role="treeitem"
              aria-expanded={e.isDir ? open : undefined}
              data-path={path}
              title={e.isDir ? path : t('files.insertHint')}
              style={{ paddingLeft: 8 + depth * 12 }}
              className="flex h-6 cursor-default items-center gap-1 rounded pr-2 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
              onClick={() => (e.isDir ? toggle(path) : insertText(info.id, refOf(path.replace(/\\/g, '/'))))}
              onContextMenu={(ev) => {
                ev.preventDefault();
                void copyText(path);
              }}
            >
              {e.isDir ? (
                <>
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {open ? <FolderOpen size={13} className="text-accent" /> : <Folder size={13} className="text-accent" />}
                </>
              ) : (
                <>
                  <span className="w-3" />
                  <FileIcon size={13} />
                </>
              )}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {status && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(status))} />}
            </div>
            {e.isDir && open && rows(path, depth + 1)}
          </div>
        );
      });

  return (
    <aside data-testid="file-panel" className="flex w-[280px] shrink-0 flex-col border-l border-border bg-panel/60">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2 text-[11px] font-semibold text-fg-muted">
        <span className="flex-1 truncate" title={cwd}>
          {t('files.title')} · {cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('files.close')}
          onClick={() => useSessions.getState().setExplorer(info.id, false)}
        >
          <X size={12} />
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('files.filter')}
          aria-label={t('files.filter')}
          className="h-6 min-w-0 flex-1 rounded border border-border bg-bg px-2 text-[12px] text-fg outline-none focus:border-accent/60"
        />
        <button
          className={cn('rounded px-1.5 py-0.5 font-mono text-[11px]', showHidden ? 'bg-hover text-fg' : 'text-fg-muted')}
          title=".files"
          onClick={() => setShowHidden((v) => !v)}
        >
          .*
        </button>
      </div>
      <div role="tree" className="min-h-0 flex-1 overflow-auto py-1">
        {rows('', 0)}
        {tree[''] && tree[''].length === 0 && <div className="px-3 py-2 text-[12px] text-fg-muted">{t('files.empty')}</div>}
      </div>
    </aside>
  );
}
