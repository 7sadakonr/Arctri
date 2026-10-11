import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { iconUrl } from '@/lib/file-icon';
import { useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { insertText, refOf } from '../agents/insert';
import { useChanges } from '../agents/useChanges';

interface Entry {
  name: string;
  isDir: boolean;
}

interface Row {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  open: boolean;
}

const ROW_H = 24;
const OVERSCAN = 12;

// What the panel last showed, per tab: reopening it paints at once and refreshes underneath (like an editor does).
const cache = new Map<string, { cwd: string; tree: Record<string, Entry[]>; expanded: Set<string> }>();

const statusDot = (s: string) => (s === '??' ? 'bg-ok' : s.includes('D') ? 'bg-danger' : 'bg-warn');

/**
 * The files below the tab's working folder (it cannot go above it). Clicking a file opens it beside the terminal;
 * Alt+click puts its path into the message.
 */
export function FilesView({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const sep = info.env.kind === 'windows' ? '\\' : '/';
  const cwd = info.cwd?.path ?? '';
  const cached = cache.get(info.id)?.cwd === cwd ? cache.get(info.id) : undefined;
  const [tree, setTree] = useState<Record<string, Entry[]>>(cached?.tree ?? {});
  const [expanded, setExpanded] = useState<Set<string>>(cached?.expanded ?? new Set(['']));
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [rootState, setRootState] = useState<'loading' | 'ready' | 'failed'>(cached?.tree[''] ? 'ready' : 'loading');
  const [scroll, setScroll] = useState({ top: 0, height: 400 });
  // one counter per folder: a slow answer for one folder must not discard the answer of another
  const requests = useRef(new Map<string, number>());
  const known = useRef(tree);
  known.current = tree;
  const changes = useChanges(info.id, active);

  const changed = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of changes?.files ?? []) m.set(f.path.replace(/\\/g, '/'), f.status);
    return m;
  }, [changes]);

  const load = useCallback(
    async (rel: string) => {
      const id = (requests.current.get(rel) ?? 0) + 1;
      requests.current.set(rel, id);
      if (rel === '' && !known.current['']) setRootState('loading');
      try {
        const result = await api.files.list(info.id, rel);
        if (id !== requests.current.get(rel)) return;
        if (!result.ok) {
          if (rel === '' && !known.current['']) setRootState('failed');
          return;
        }
        setTree((tr) => ({ ...tr, [rel]: result.entries }));
        if (rel === '') setRootState('ready');
      } catch {
        if (id === requests.current.get(rel) && rel === '' && !known.current['']) setRootState('failed');
      }
    },
    [info.id]
  );

  // a new working folder is a new root; the same one keeps what it had and refreshes it
  const first = useRef(true);
  useEffect(() => {
    const keep = first.current && cached;
    first.current = false;
    if (!keep) {
      setTree({});
      setExpanded(new Set(['']));
      setRootState('loading');
      requests.current.clear();
    }
    const dirs = keep ? [...cached.expanded] : [''];
    for (const d of dirs) void load(d);
    // `cached` is only the starting point, so it is not a dependency
  }, [cwd, load]);

  useEffect(() => {
    cache.set(info.id, { cwd, tree, expanded });
  }, [info.id, cwd, tree, expanded]);

  const refreshOpen = useCallback(() => {
    for (const d of expanded) void load(d);
  }, [expanded, load]);

  // new or finished work changes the folders: refresh when the set of changed files moves and when the window returns
  const signature = changes ? changes.files.map((f) => `${f.status}${f.path}`).join('\n') : '';
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    if (active) refreshOpen();
  }, [signature, active, refreshOpen]);
  useEffect(() => {
    if (!active) return;
    const onFocus = () => refreshOpen();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [active, refreshOpen]);

  const toggle = (rel: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(rel)) next.delete(rel);
      else {
        next.add(rel);
        void load(rel);
      }
      return next;
    });
  };

  const join = useCallback((rel: string, name: string) => (rel ? `${rel}${sep}${name}` : name), [sep]);
  const lowered = filter.toLowerCase();

  const rows = useMemo(() => {
    const match = (name: string) => !lowered || name.toLowerCase().includes(lowered);
    const visible = (e: Entry) => showHidden || !e.name.startsWith('.');
    const memo = new Map<string, boolean>();
    const subtreeMatches = (rel: string): boolean => {
      const hit = memo.get(rel);
      if (hit !== undefined) return hit;
      const r = (tree[rel] ?? []).some((e) => visible(e) && (match(e.name) || (e.isDir && subtreeMatches(join(rel, e.name)))));
      memo.set(rel, r);
      return r;
    };
    const out: Row[] = [];
    const walk = (rel: string, depth: number) => {
      for (const e of tree[rel] ?? []) {
        if (!visible(e) || !(match(e.name) || (e.isDir && subtreeMatches(join(rel, e.name))))) continue;
        const path = join(rel, e.name);
        const open = e.isDir && (expanded.has(path) || (!!lowered && subtreeMatches(path)));
        out.push({ path, name: e.name, isDir: e.isDir, depth, open });
        if (open) walk(path, depth + 1);
      }
    };
    walk('', 0);
    return out;
  }, [tree, expanded, lowered, showHidden, join]);

  // only the rows in view are drawn: a folder with thousands of entries stays smooth
  const from = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN);
  const to = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      <div
        role="tree"
        className="min-h-0 flex-1 overflow-auto py-1"
        ref={(el) => {
          if (el && el.clientHeight && el.clientHeight !== scroll.height) setScroll((s) => ({ ...s, height: el.clientHeight }));
        }}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      >
        <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
          {rows.slice(from, to).map((e, n) => {
            const status = changed.get(e.path.replace(/\\/g, '/'));
            return (
              <div
                key={e.path}
                role="treeitem"
                aria-expanded={e.isDir ? e.open : undefined}
                data-path={e.path}
                title={e.isDir ? e.path : t('files.insertHint')}
                style={{ position: 'absolute', top: (from + n) * ROW_H, height: ROW_H, left: 0, right: 0, paddingLeft: 8 + e.depth * 12 }}
                className="flex cursor-default items-center gap-1 rounded pr-2 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
                onClick={(ev) => {
                  if (e.isDir) toggle(e.path);
                  else if (ev.altKey) insertText(info.id, refOf(e.path.replace(/\\/g, '/')));
                  else useSessions.getState().openViewer(info.id, e.path, 'file');
                }}
                onMouseEnter={() => {
                  // have the folder ready before the click
                  if (e.isDir && !known.current[e.path]) void load(e.path);
                }}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  void copyText(e.path);
                }}
              >
                {e.isDir ? (
                  e.open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <img src={iconUrl(e.name, e.isDir, e.open)} alt="" width={16} height={16} draggable={false} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {status && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(status))} />}
              </div>
            );
          })}
        </div>
        {rootState === 'loading' && <div className="px-3 py-2 text-[12px] text-fg-muted">…</div>}
        {rootState === 'ready' && tree['']?.length === 0 && <div className="px-3 py-2 text-[12px] text-fg-muted">{t('files.empty')}</div>}
        {rootState === 'failed' && (
          <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-fg-muted">
            <span className="flex-1">{t('files.loadFailed')}</span>
            <Button variant="outline" size="sm" onClick={() => void load('')}>
              {t('files.retry')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
