import { ChevronDown, ChevronRight, ChevronsDownUp, FilePlus, FolderPlus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { iconUrl } from '@/lib/file-icon';
import { useT } from '@/lib/i18n';
import { isMac } from '@/lib/platform';
import { useSessions } from '@/stores/sessions';
import { useFileClip } from './fileClipboard';
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
  /** The row that stands in for a file or folder that is being named. */
  draft?: 'file' | 'dir';
}

type Edit = { mode: 'rename'; path: string } | { mode: 'create'; parent: string; kind: 'file' | 'dir' };

const ROW_H = 24;
const DRAG_TYPE = 'application/x-arctri-files';
const EXPAND_ON_HOVER_MS = 600;
const POLL_MS = 3000;
const OVERSCAN = 12;

// What the panel last showed, per tab: reopening it paints at once and refreshes underneath (like an editor does).
const cache = new Map<string, { cwd: string; tree: Record<string, Entry[]>; expanded: Set<string>; showHidden: boolean }>();

// never listed, as in VS Code's default `files.exclude`
const ALWAYS_HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db']);
const BAD_NAME_WINDOWS = /[<>:"|?*]/;

/** The text of a name that is being typed; Enter accepts, Escape or leaving the field gives up. */
function NameInput({
  initial, selectEnd, error, onCommit, onCancel
}: { initial: string; selectEnd: number; error?: string | undefined; onCommit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const born = useRef(performance.now());
  const finished = useRef(false);
  useEffect(() => {
    // the menu that started this hands the focus back as it closes: take it again once it has
    const focus = () => {
      ref.current?.focus();
      ref.current?.setSelectionRange(0, selectEnd);
    };
    focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [selectEnd]);
  const finish = (fn: () => void) => {
    if (finished.current) return;
    finished.current = true;
    fn();
  };
  return (
    <span className="relative min-w-0 flex-1">
      <input
        ref={ref}
        defaultValue={initial}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-[18px] w-full rounded border bg-bg px-1 text-[12px] text-fg outline-none',
          error ? 'border-danger' : 'border-accent/60'
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            const name = e.currentTarget.value.trim();
            if (name) onCommit(name);
            else finish(onCancel);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(onCancel);
          }
        }}
        onBlur={(e) => {
          if (performance.now() - born.current < 250) e.currentTarget.focus();
          else finish(onCancel);
        }}
      />
      {error && (
        <span role="alert" className="absolute left-0 top-[19px] z-10 rounded border border-danger bg-panel px-1.5 py-0.5 text-[11px] text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

const statusDot = (s: string) => (s === '??' ? 'bg-ok' : s.includes('D') ? 'bg-danger' : 'bg-warn');

const sameEntries = (a: Entry[] | undefined, b: Entry[]) =>
  !!a && a.length === b.length && a.every((e, n) => e.name === b[n]!.name && e.isDir === b[n]!.isDir);

/**
 * The files below the tab's working folder (it cannot go above it). Clicking a file opens it beside the terminal;
 * Alt+click puts its path into the message. Several rows can be picked (Ctrl/Shift+click) and cut, copied, pasted,
 * dragged to another folder, renamed (F2) or deleted. Changes made elsewhere show up on their own.
 */
export function FilesView({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const sep = info.env.kind === 'windows' ? '\\' : '/';
  const cwd = info.cwd?.path ?? '';
  const cached = cache.get(info.id)?.cwd === cwd ? cache.get(info.id) : undefined;
  const [tree, setTree] = useState<Record<string, Entry[]>>(cached?.tree ?? {});
  const [expanded, setExpanded] = useState<Set<string>>(cached?.expanded ?? new Set(['']));
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(cached?.showHidden ?? true);
  const [rootState, setRootState] = useState<'loading' | 'ready' | 'failed'>(cached?.tree[''] ? 'ready' : 'loading');
  const [scroll, setScroll] = useState({ top: 0, height: 400 });
  // `selected` is the row the keyboard works from; `picked` is everything highlighted (it always holds `selected`)
  const [selected, setSelected] = useState<string | undefined>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | undefined>(undefined);
  const [edit, setEdit] = useState<Edit | undefined>();
  const [editError, setEditError] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<Array<{ path: string; name: string }> | undefined>();
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [dropHint, setDropHint] = useState<string | undefined>();
  const [polling, setPolling] = useState(false);
  const clip = useFileClip((st) => st.clip);
  const treeEl = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<string[] | undefined>(undefined);
  const hoverOpen = useRef<{ path: string; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
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
        // an unchanged folder keeps its object: polling must not redraw the panel
        setTree((tr) => (sameEntries(tr[rel], result.entries) ? tr : { ...tr, [rel]: result.entries }));
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
      setSelected(undefined);
      setPicked(new Set());
      setEdit(undefined);
      requests.current.clear();
    }
    const dirs = keep ? [...cached.expanded] : [''];
    for (const d of dirs) void load(d);
    // `cached` is only the starting point, so it is not a dependency
  }, [cwd, load]);

  useEffect(() => {
    cache.set(info.id, { cwd, tree, expanded, showHidden });
  }, [info.id, cwd, tree, expanded, showHidden]);

  const refreshOpen = useCallback(() => {
    for (const d of expanded) void load(d);
  }, [expanded, load]);
  const refreshRef = useRef(refreshOpen);
  refreshRef.current = refreshOpen;

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

  // Changes from elsewhere: the main process watches the open folders and names the ones that changed.
  // Where it cannot (a WSL folder), the panel looks again every few seconds while it is in front.
  useEffect(() => {
    if (!active) {
      void api.files.watch(info.id, []);
      return;
    }
    let live = true;
    void api.files.watch(info.id, [...expanded]).then((r) => live && setPolling(r.polling), () => undefined);
    return () => {
      live = false;
    };
  }, [active, expanded, info.id]);
  useEffect(() => () => void api.files.watch(info.id, []), [info.id]);
  useEffect(
    () =>
      api.files.onChanged(({ id, dirs }) => {
        if (id !== info.id) return;
        for (const d of dirs) void load(d);
      }),
    [info.id, load]
  );
  useEffect(() => {
    if (!active || !polling) return;
    const timer = setInterval(() => {
      if (document.hasFocus()) refreshRef.current();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, polling]);

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
  const parentOf = useCallback((rel: string) => {
    const i = rel.lastIndexOf(sep);
    return i < 0 ? '' : rel.slice(0, i);
  }, [sep]);
  const under = useCallback((p: string, base: string) => p === base || p.startsWith(base + sep), [sep]);
  /** Without the paths that sit inside another one of the list (acting on the folder acts on them). */
  const topLevel = useCallback((paths: string[]) => paths.filter((p) => !paths.some((o) => o !== p && under(p, o))), [under]);
  const lowered = filter.toLowerCase();

  const rows = useMemo(() => {
    const match = (name: string) => !lowered || name.toLowerCase().includes(lowered);
    const visible = (e: Entry) => !ALWAYS_HIDDEN.has(e.name) && (showHidden || !e.name.startsWith('.'));
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
      if (edit?.mode === 'create' && edit.parent === rel) {
        out.push({ path: join(rel, '\u0000new'), name: '', isDir: edit.kind === 'dir', depth, open: false, draft: edit.kind });
      }
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
  }, [tree, expanded, lowered, showHidden, join, edit]);

  // only the rows in view are drawn: a folder with thousands of entries stays smooth
  const from = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN);
  const to = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN);

  // a row that is being named must be on screen
  useEffect(() => {
    const el = treeEl.current;
    if (!el || !edit) return;
    const at = rows.findIndex((r) => (edit.mode === 'create' ? r.draft : r.path === edit.path));
    if (at < 0) return;
    const top = at * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [edit, rows]);

  const errorText = (code: string | undefined) => (code === 'exists' ? t('files.exists') : t('files.opFailed'));
  const nameProblem = (name: string) =>
    name === '.' || name === '..' || /[\\/]/.test(name) || (info.env.kind === 'windows' && BAD_NAME_WINDOWS.test(name)) ? t('files.invalidName') : undefined;

  const stopEdit = () => {
    setEdit(undefined);
    setEditError(undefined);
    treeEl.current?.focus();
  };

  const only = (rel: string | undefined) => {
    setSelected(rel);
    setPicked(rel === undefined ? new Set() : new Set([rel]));
    anchor.current = rel;
  };
  /** Picks everything from the anchor to `rel` (Shift+click, Shift+arrows). */
  const extendTo = (rel: string) => {
    const a = rows.findIndex((r) => r.path === (anchor.current ?? rel));
    const b = rows.findIndex((r) => r.path === rel);
    if (a < 0 || b < 0) return only(rel);
    setSelected(rel);
    setPicked(new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter((r) => !r.draft).map((r) => r.path)));
  };
  const reveal = (rel: string) => {
    const el = treeEl.current;
    const at = rows.findIndex((r) => r.path === rel);
    if (!el || at < 0) return;
    if (at * ROW_H < el.scrollTop) el.scrollTop = at * ROW_H;
    else if ((at + 1) * ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = (at + 1) * ROW_H - el.clientHeight;
  };

  const startCreate = (parent: string, kind: 'file' | 'dir') => {
    setFilter('');
    if (parent) {
      setExpanded((cur) => new Set(cur).add(parent));
      if (!known.current[parent]) void load(parent);
    }
    setEditError(undefined);
    setEdit({ mode: 'create', parent, kind });
  };

  const startRename = (row: Row) => {
    setFilter('');
    setEditError(undefined);
    setEdit({ mode: 'rename', path: row.path });
  };

  const askDelete = (paths: string[]) => {
    const list = topLevel(paths);
    if (!list.length) return;
    setDeleteError(undefined);
    setPendingDelete(list.map((path) => ({ path, name: path.slice(path.lastIndexOf(sep) + 1) })));
  };

  /** What a menu or a key acts on: the picked rows when `row` is one of them, else just `row`. */
  const acting = (row: Row | undefined): string[] => (!row ? [] : picked.has(row.path) ? topLevel([...picked]) : [row.path]);

  /** Where "new file" and "paste" go for the toolbar and the keyboard: into the selected folder, beside the selected file, else the root. */
  const destParent = () => {
    const row = selected === undefined ? undefined : rows.find((r) => r.path === selected);
    return !row ? '' : row.isDir ? row.path : parentOf(row.path);
  };

  const commitCreate = async (name: string) => {
    if (edit?.mode !== 'create') return;
    const problem = nameProblem(name);
    if (problem) return setEditError(problem);
    const rel = join(edit.parent, name);
    const res = await api.files.create(info.id, rel, edit.kind);
    if (!res.ok) return setEditError(errorText(res.error));
    const { parent, kind } = edit;
    stopEdit();
    await load(parent);
    only(rel);
    if (kind === 'file') useSessions.getState().openViewer(info.id, rel, 'file');
  };

  /** Viewer tabs that show something under `base`, so a rename, a move or a delete can follow them. */
  const viewerTabsUnder = (base: string) => (useSessions.getState().viewer[info.id]?.tabs ?? []).filter((x) => under(x.rel, base));

  /** Everything the panel remembers about `old` follows it to `next`; the folders to look at again are returned. */
  const followMove = (old: string, next: string): string[] => {
    const moved = (p: string) => next + p.slice(old.length);
    const store = useSessions.getState();
    for (const tab of viewerTabsUnder(old)) {
      if (tab.mode === 'file') store.openViewer(info.id, moved(tab.rel), 'file');
      store.closeViewer(info.id, tab.rel);
    }
    const reopen = [...expanded].filter((x) => under(x, old)).map(moved);
    setExpanded((cur) => new Set([...cur].map((x) => (under(x, old) ? moved(x) : x))));
    setTree((tr) => Object.fromEntries(Object.entries(tr).filter(([k]) => !under(k, old))));
    return reopen;
  };

  const commitRename = async (name: string) => {
    if (edit?.mode !== 'rename') return;
    const old = edit.path;
    if (name === old.slice(old.lastIndexOf(sep) + 1)) return stopEdit();
    const problem = nameProblem(name);
    if (problem) return setEditError(problem);
    const next = join(parentOf(old), name);
    const res = await api.files.rename(info.id, old, next);
    if (!res.ok) return setEditError(errorText(res.error));
    stopEdit();
    const reopen = followMove(old, next);
    only(next);
    await Promise.all([load(parentOf(old)), ...reopen.map((d) => load(d))]);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    let failed = 0;
    const gone: string[] = [];
    for (const { path } of pendingDelete) {
      const res = await api.files.remove(info.id, path);
      if (res.ok) gone.push(path);
      else failed++;
    }
    const store = useSessions.getState();
    for (const path of gone) for (const tab of viewerTabsUnder(path)) store.closeViewer(info.id, tab.rel);
    const goneUnder = (p: string) => gone.some((g) => under(p, g));
    setExpanded((cur) => new Set([...cur].filter((x) => !goneUnder(x))));
    setTree((tr) => Object.fromEntries(Object.entries(tr).filter(([k]) => !goneUnder(k))));
    setPicked((cur) => new Set([...cur].filter((x) => !goneUnder(x))));
    setSelected((cur) => (cur !== undefined && goneUnder(cur) ? undefined : cur));
    await Promise.all([...new Set(gone.map(parentOf))].map((d) => load(d)));
    if (failed) setDeleteError(failed > 1 ? t('files.partialFailed', { count: failed }) : t('files.opFailed'));
    else setPendingDelete(undefined);
    if (failed) setPendingDelete((cur) => cur?.filter((x) => !gone.includes(x.path)));
  };

  /** Cut/Copy puts the paths aside; Paste (or a drop) moves or copies them into a folder. */
  const takeAside = (paths: string[], mode: 'cut' | 'copy') => {
    const list = topLevel(paths);
    if (list.length) useFileClip.getState().set({ sessionId: info.id, paths: list, mode });
  };

  const transfer = async (paths: string[], toDir: string, mode: 'move' | 'copy') => {
    const list = topLevel(paths).filter((p) => !(mode === 'move' && parentOf(p) === toDir));
    // a folder cannot go into itself or below itself
    if (!list.length || list.some((p) => under(toDir, p))) return;
    const answer = await (mode === 'move' ? api.files.move : api.files.copy)(info.id, list, toDir);
    const reload = new Set<string>([toDir]);
    const created: string[] = [];
    let failed = 0;
    let code: string | undefined;
    for (const r of answer.results) {
      if (r.error || !r.to) {
        failed++;
        code ??= r.error;
        continue;
      }
      created.push(r.to);
      if (mode === 'move') {
        reload.add(parentOf(r.from));
        for (const d of followMove(r.from, r.to)) reload.add(d);
      }
    }
    if (toDir) {
      setExpanded((cur) => new Set(cur).add(toDir));
      reload.add(toDir);
    }
    await Promise.all([...reload].map((d) => load(d)));
    if (created.length) {
      setPicked(new Set(created));
      setSelected(created[created.length - 1]);
      anchor.current = created[0];
    }
    setNotice(failed ? (failed > 1 ? t('files.partialFailed', { count: failed }) : errorText(code)) : undefined);
  };

  const paste = async (toDir: string) => {
    const c = useFileClip.getState().clip;
    if (!c || c.sessionId !== info.id) return;
    await transfer(c.paths, toDir, c.mode === 'cut' ? 'move' : 'copy');
    if (c.mode === 'cut') useFileClip.getState().set(undefined);
  };

  const absOf = (rel: string) => (rel ? `${cwd.replace(/[\\/]$/, '')}${sep}${rel}` : cwd);

  const select = (rel: string | undefined, extend = false) => {
    if (rel === undefined) return;
    if (extend) extendTo(rel);
    else only(rel);
    reveal(rel);
  };

  const modKey = (ev: { ctrlKey: boolean; metaKey: boolean }) => (isMac ? ev.metaKey : ev.ctrlKey);

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (edit || pendingDelete || ev.target !== ev.currentTarget) return;
    const at = selected === undefined ? -1 : rows.findIndex((r) => r.path === selected);
    const row = at < 0 ? undefined : rows[at];
    const open = (r: Row) => (r.isDir ? toggle(r.path) : useSessions.getState().openViewer(info.id, r.path, 'file'));
    const mod = modKey(ev);
    if (ev.key === 'ArrowDown') select(rows[Math.min(rows.length - 1, at + 1)]?.path, ev.shiftKey);
    else if (ev.key === 'ArrowUp') select(rows[Math.max(0, at - 1)]?.path, ev.shiftKey);
    else if (ev.key === 'ArrowRight' && row?.isDir) {
      if (!row.open) toggle(row.path);
      else if (rows[at + 1] && rows[at + 1]!.depth > row.depth) select(rows[at + 1]!.path);
    } else if (ev.key === 'ArrowLeft' && row) {
      if (row.isDir && row.open) toggle(row.path);
      else select(rows.slice(0, at).reverse().find((r) => r.depth < row.depth)?.path);
    } else if (ev.key === 'Enter' && row) open(row);
    else if (ev.key === 'F2' && row && picked.size <= 1) startRename(row);
    else if ((ev.key === 'Delete' || (isMac && ev.metaKey && ev.key === 'Backspace')) && row) askDelete(acting(row));
    else if (mod && ev.key.toLowerCase() === 'a') {
      const all = rows.filter((r) => !r.draft).map((r) => r.path);
      setPicked(new Set(all));
      setSelected((cur) => cur ?? all[0]);
    } else if (mod && ev.key.toLowerCase() === 'c' && row) takeAside(acting(row), 'copy');
    else if (mod && ev.key.toLowerCase() === 'x' && row) takeAside(acting(row), 'cut');
    else if (mod && ev.key.toLowerCase() === 'v') void paste(destParent());
    else if (ev.key === 'Escape' && (picked.size > 1 || clip)) {
      useFileClip.getState().set(undefined);
      only(selected);
    } else return;
    ev.preventDefault();
  };

  // ---- drag & drop
  const dropDirOf = (row: Row | undefined) => (!row ? '' : row.isDir ? row.path : parentOf(row.path));
  const clearHover = () => {
    if (hoverOpen.current) clearTimeout(hoverOpen.current.timer);
    hoverOpen.current = undefined;
  };
  const endDrag = () => {
    dragging.current = undefined;
    setDropHint(undefined);
    clearHover();
  };
  const canDrop = (toDir: string) => !!dragging.current && !dragging.current.some((p) => under(toDir, p));
  const dragOver = (ev: React.DragEvent, row: Row | undefined) => {
    if (!canDrop(dropDirOf(row))) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = ev.altKey ? 'copy' : 'move';
    const dir = dropDirOf(row);
    setDropHint(dir);
    // a folder held over for a moment opens, so the way down to the target can be followed
    if (row?.isDir && !row.open && hoverOpen.current?.path !== row.path) {
      clearHover();
      hoverOpen.current = { path: row.path, timer: setTimeout(() => toggle(row.path), EXPAND_ON_HOVER_MS) };
    } else if (!row?.isDir || row.open) clearHover();
  };
  const drop = (ev: React.DragEvent, row: Row | undefined) => {
    const paths = dragging.current;
    const dir = dropDirOf(row);
    if (!paths || !canDrop(dir)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const copying = ev.altKey;
    endDrag();
    void transfer(paths, dir, copying ? 'copy' : 'move');
  };

  const menu = (row: Row | undefined) => {
    const parent = dropDirOf(row);
    const targets = acting(row);
    const one = targets.length === 1;
    const canPaste = !!clip && clip.sessionId === info.id;
    // the menu hands the focus back as it closes: start the naming after that
    const later = (fn: () => void) => () => setTimeout(fn, 0);
    const mod = isMac ? '⌘' : 'Ctrl+';
    return (
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        {row && one && !row.isDir && <ContextMenuItem onSelect={() => useSessions.getState().openViewer(info.id, row.path, 'file')}>{t('files.open')}</ContextMenuItem>}
        {row && (
          <ContextMenuItem onSelect={() => insertText(info.id, targets.map((p) => refOf(p.replace(/\\/g, '/'))).join(' '))}>
            {t('files.insertPath')}
          </ContextMenuItem>
        )}
        {row && <ContextMenuSeparator />}
        <ContextMenuItem onSelect={later(() => startCreate(parent, 'file'))}>{t('files.newFile')}</ContextMenuItem>
        <ContextMenuItem onSelect={later(() => startCreate(parent, 'dir'))}>{t('files.newFolder')}</ContextMenuItem>
        <ContextMenuSeparator />
        {row && (
          <>
            <ContextMenuItem onSelect={() => takeAside(targets, 'cut')}>
              {t('files.cut')}
              <ContextMenuShortcut>{mod}X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => takeAside(targets, 'copy')}>
              {t('files.copy')}
              <ContextMenuShortcut>{mod}C</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        <ContextMenuItem disabled={!canPaste} onSelect={() => void paste(parent)}>
          {t('files.paste')}
          <ContextMenuShortcut>{mod}V</ContextMenuShortcut>
        </ContextMenuItem>
        {row && (
          <>
            <ContextMenuSeparator />
            {one && (
              <ContextMenuItem onSelect={later(() => startRename(row))}>
                {t('files.rename')}
                <ContextMenuShortcut>F2</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={later(() => askDelete(targets))}>
              {t('files.delete')}
              <ContextMenuShortcut>{isMac ? '⌘⌫' : 'Del'}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void copyText(targets.map(absOf).join('\n'))}>{t('files.copyPath')}</ContextMenuItem>
            <ContextMenuItem onSelect={() => void copyText(targets.join('\n'))}>{t('files.copyRelPath')}</ContextMenuItem>
          </>
        )}
        {!row && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => refreshOpen()}>{t('files.refresh')}</ContextMenuItem>
          </>
        )}
        {(!row || one) && <ContextMenuItem onSelect={() => void api.files.reveal(info.id, row?.path ?? '')}>{t('files.reveal')}</ContextMenuItem>}
      </ContextMenuContent>
    );
  };

  const tool = 'rounded p-1 text-fg-muted hover:bg-hover hover:text-fg';
  const cutSet = useMemo(() => (clip?.mode === 'cut' && clip.sessionId === info.id ? new Set(clip.paths) : undefined), [clip, info.id]);

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
        <button className={tool} title={t('files.newFile')} aria-label={t('files.newFile')} onClick={() => startCreate(destParent(), 'file')}>
          <FilePlus size={14} />
        </button>
        <button className={tool} title={t('files.newFolder')} aria-label={t('files.newFolder')} onClick={() => startCreate(destParent(), 'dir')}>
          <FolderPlus size={14} />
        </button>
        <button className={tool} title={t('files.refresh')} aria-label={t('files.refresh')} onClick={refreshOpen}>
          <RefreshCw size={14} />
        </button>
        <button className={tool} title={t('files.collapseAll')} aria-label={t('files.collapseAll')} onClick={() => setExpanded(new Set(['']))}>
          <ChevronsDownUp size={14} />
        </button>
        <button
          className={cn('rounded px-1.5 py-0.5 font-mono text-[11px]', showHidden ? 'bg-hover text-fg' : 'text-fg-muted')}
          title={showHidden ? t('files.hideDotfiles') : t('files.showDotfiles')}
          aria-label={showHidden ? t('files.hideDotfiles') : t('files.showDotfiles')}
          aria-pressed={showHidden}
          onClick={() => setShowHidden((v) => !v)}
        >
          .*
        </button>
      </div>
      {notice && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-[11px] text-danger">
          <span className="min-w-0 flex-1">{notice}</span>
          <button className="text-fg-muted hover:text-fg" aria-label={t('common.close')} onClick={() => setNotice(undefined)}>
            ×
          </button>
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="tree"
            aria-multiselectable
            tabIndex={0}
            className={cn('min-h-0 flex-1 overflow-auto py-1 outline-none', dropHint === '' && dragging.current && 'bg-accent/5')}
            ref={(el) => {
              treeEl.current = el;
              if (el && el.clientHeight && el.clientHeight !== scroll.height) setScroll((s) => ({ ...s, height: el.clientHeight }));
            }}
            onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
            onKeyDown={onKeyDown}
            onContextMenu={() => only(undefined)}
            onDragOver={(ev) => dragOver(ev, undefined)}
            onDrop={(ev) => drop(ev, undefined)}
            onDragLeave={(ev) => {
              if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDropHint(undefined);
            }}
          >
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {rows.slice(from, to).map((e, n) => {
                const status = changed.get(e.path.replace(/\\/g, '/'));
                const renaming = edit?.mode === 'rename' && edit.path === e.path;
                const naming = renaming || !!e.draft;
                const dot = e.name.lastIndexOf('.');
                const isPicked = picked.has(e.path);
                const target = !!dragging.current && e.isDir && dropHint === e.path;
                const body = (
                  <div
                    role="treeitem"
                    aria-expanded={e.isDir ? e.open : undefined}
                    aria-selected={isPicked}
                    data-path={e.draft ? undefined : e.path}
                    title={e.isDir ? e.path : t('files.insertHint')}
                    draggable={!naming}
                    style={{ position: 'absolute', top: (from + n) * ROW_H, height: ROW_H, left: 0, right: 0, paddingLeft: 8 + e.depth * 12 }}
                    className={cn(
                      'flex cursor-default items-center gap-1 rounded pr-2 text-[12px] hover:bg-hover hover:text-fg',
                      isPicked ? 'bg-hover text-fg' : 'text-fg-muted',
                      cutSet?.has(e.path) && 'opacity-50',
                      target && 'outline outline-1 outline-accent'
                    )}
                    onClick={(ev) => {
                      if (naming) return;
                      treeEl.current?.focus();
                      if (modKey(ev)) {
                        setPicked((cur) => {
                          const next = new Set(cur);
                          if (next.has(e.path)) next.delete(e.path);
                          else next.add(e.path);
                          return next;
                        });
                        setSelected(e.path);
                        anchor.current = e.path;
                        return;
                      }
                      if (ev.shiftKey) return extendTo(e.path);
                      only(e.path);
                      if (e.isDir) toggle(e.path);
                      else if (ev.altKey) insertText(info.id, refOf(e.path.replace(/\\/g, '/')));
                      else useSessions.getState().openViewer(info.id, e.path, 'file');
                    }}
                    onMouseEnter={() => {
                      // have the folder ready before the click
                      if (e.isDir && !e.draft && !known.current[e.path]) void load(e.path);
                    }}
                    onContextMenu={(ev) => {
                      // the row's own menu, not the one of the empty area behind it; a row inside the picked ones keeps them
                      ev.stopPropagation();
                      if (!picked.has(e.path)) only(e.path);
                      else setSelected(e.path);
                    }}
                    onDragStart={(ev) => {
                      const paths = picked.has(e.path) ? topLevel([...picked]) : [e.path];
                      if (!picked.has(e.path)) only(e.path);
                      dragging.current = paths;
                      ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
                      ev.dataTransfer.effectAllowed = 'copyMove';
                    }}
                    onDragEnd={endDrag}
                    onDragOver={(ev) => dragOver(ev, e)}
                    onDrop={(ev) => drop(ev, e)}
                  >
                    {e.isDir ? (
                      e.open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <img src={iconUrl(e.name, e.isDir, e.open)} alt="" width={16} height={16} draggable={false} className={cn('shrink-0', e.name.startsWith('.') && 'opacity-50')} />
                    {naming ? (
                      <NameInput
                        initial={e.name}
                        selectEnd={e.isDir || dot <= 0 ? e.name.length : dot}
                        error={editError}
                        onCommit={(name) => void (renaming ? commitRename(name) : commitCreate(name))}
                        onCancel={stopEdit}
                      />
                    ) : (
                      <span className={cn('min-w-0 flex-1 truncate', e.name.startsWith('.') && !isPicked && 'opacity-60')}>{e.name}</span>
                    )}
                    {status && !naming && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(status))} />}
                  </div>
                );
                return e.draft ? (
                  <div key={e.path}>{body}</div>
                ) : (
                  <ContextMenu key={e.path}>
                    <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
                    {menu(e)}
                  </ContextMenu>
                );
              })}
            </div>
            {rootState === 'loading' && <div className="px-3 py-2 text-[12px] text-fg-muted">…</div>}
            {rootState === 'ready' && tree['']?.length === 0 && !edit && <div className="px-3 py-2 text-[12px] text-fg-muted">{t('files.empty')}</div>}
            {rootState === 'failed' && (
              <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-fg-muted">
                <span className="flex-1">{t('files.loadFailed')}</span>
                <Button variant="outline" size="sm" onClick={() => void load('')}>
                  {t('files.retry')}
                </Button>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        {menu(undefined)}
      </ContextMenu>
      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(undefined)}>
        {pendingDelete && (
          <DialogContent
            title={pendingDelete.length === 1 ? t('files.deleteTitle', { name: pendingDelete[0]!.name }) : t('files.deleteMany', { count: pendingDelete.length })}
            closeLabel={t('common.close')}
            className="w-[min(420px,92vw)]"
          >
            <p className="mb-4 text-xs text-fg-muted">{info.env.kind === 'wsl' ? t('files.deletePermanent') : t('files.deleteTrash')}</p>
            {deleteError && (
              <p role="alert" className="mb-3 text-xs text-danger">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingDelete(undefined)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" autoFocus onClick={() => void confirmDelete()}>
                {t('files.delete')}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
