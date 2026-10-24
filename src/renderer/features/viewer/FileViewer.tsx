import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { AtSign, Columns2, FileDiff, FileText, Maximize2, Minimize2, Rows2, Save, WrapText, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { kbd } from '@/lib/platform';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { insertText, refOf } from '../agents/insert';
import { refreshChanges, useChanges } from '../agents/useChanges';
import { iconUrl } from '@/lib/file-icon';
import { ImageView, isImage } from './ImageView';
import { languageFor } from './language';

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--ad-bg)', color: 'var(--ad-fg)', fontSize: '12.5px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, "Roboto Mono", monospace)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--ad-accent)' },
  '.cm-gutters': { backgroundColor: 'var(--ad-panel)', color: 'var(--ad-fg-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--ad-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ad-hover)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--ad-accent) 28%, transparent)' },
  '.cm-changedLine': { backgroundColor: 'rgba(63,162,76,0.14)' },
  '.cm-deletedChunk': { backgroundColor: 'rgba(224,85,76,0.12)' },
  '.cm-insertedLine, .cm-deletedLine': { textDecoration: 'none' },
  '.cm-changedText': { backgroundColor: 'rgba(63,162,76,0.3)' },
  '.cm-deletedChunk .cm-deletedText': { backgroundColor: 'rgba(224,85,76,0.32)' },
  '.cm-panels': { backgroundColor: 'var(--ad-panel)', color: 'var(--ad-fg)' },
  // "12 unchanged lines": a quiet bar in the panel colour instead of the library's white strip (made for light themes;
  // its rules are more specific than ours, hence !important)
  '.cm-collapsedLines': {
    background: 'var(--ad-panel) !important',
    backgroundImage: 'none !important',
    color: 'var(--ad-fg-muted) !important',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    fontSize: '11px',
    lineHeight: '1.4',
    padding: '4px 10px',
    borderTop: '1px solid var(--ad-border)',
    borderBottom: '1px solid var(--ad-border)',
    textAlign: 'center'
  },
  '.cm-collapsedLines:hover': { background: 'var(--ad-hover) !important', color: 'var(--ad-fg) !important' },
  '.cm-collapsedLines:before, .cm-collapsedLines:after': { opacity: '0.5' }
});

// Mid-tone colours that read on both the dark and the light theme.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: '#c678dd' },
  { tag: [t.string, t.special(t.string)], color: '#4fa66a' },
  { tag: [t.number, t.bool, t.null], color: '#d19a66' },
  { tag: [t.comment, t.docComment], color: '#7d8396', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#4a90e2' },
  { tag: [t.typeName, t.className, t.namespace], color: '#d6a550' },
  { tag: [t.propertyName, t.attributeName], color: '#d0626b' },
  { tag: [t.heading], color: '#4a90e2', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: '#4a90e2', textDecoration: 'underline' }
]);

const baseName = (rel: string) => rel.replace(/\\/g, '/').split('/').at(-1) ?? rel;

type Doc =
  | { state: 'loading' }
  | { state: 'error'; error: 'too-large' | 'binary' | 'not-found' | 'denied' | 'failed' }
  | { state: 'ready'; eol: 'lf' | 'crlf'; bom: boolean; mtimeMs: number };

/**
 * Shows one file below the tab's folder: as it is (and editable) or as the difference against HEAD. A file an agent is
 * changing is reloaded when it changes on disk, unless it has unsaved edits here.
 */
export function FileViewer({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const view = useSessions((s) => s.viewer[info.id]);
  const rel = view?.active ?? '';
  const curTab = view?.tabs.find((x) => x.rel === rel);
  const mode = curTab?.mode ?? 'file';
  // `rel` is the tab's identity; the file is `path`, and with `rev` it is shown as that commit changed it (read-only)
  const path = curTab?.path ?? rel;
  const rev = curTab?.rev;
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | undefined>(undefined);
  const split = useRef<MergeView | undefined>(undefined);
  const [sideBySide, setSideBySide] = useState(false);
  const lang = useRef(new Compartment());
  const [doc, setDoc] = useState<Doc>({ state: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [noHead, setNoHead] = useState(false);
  const [noChange, setNoChange] = useState(false);
  const savedWidth = useUi((s) => s.prefs.viewerWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const maximized = !!view?.maximized;
  const changes = useChanges(info.id, active);
  const setMaximized = (on: boolean) => useSessions.getState().setViewerMaximized(info.id, on);
  const [wrap, setWrap] = useState(true);
  const wrapC = useRef(new Compartment());
  const wrapRef = useRef(true);
  wrapRef.current = wrap;
  const width = dragWidth ?? savedWidth;
  const saveWidth = (w: number) => {
    if (w !== savedWidth) useUi.getState().setPrefs({ ...useUi.getState().prefs, viewerWidth: w }); // no snap-back while the save is in flight
    setDragWidth(null);
    if (w !== savedWidth) void api.prefs.set({ viewerWidth: w }).then((p) => useUi.getState().setPrefs(p), () => undefined);
  };
  const [nonce, setNonce] = useState(0); // bumped to load the file again
  const mtime = useRef(0);
  const dirtyRef = useRef(false);
  const textRef = useRef<string | undefined>(undefined); // unsaved text carried over when only the mode changes
  // editor state (text, undo history, cursor) of the tabs that are not on screen
  const cache = useRef(new Map<string, { state: EditorState; eol: 'lf' | 'crlf'; bom: boolean; mtime: number; noHead: boolean }>());
  const shown = useRef<string | undefined>(undefined); // the file the editor currently holds
  const meta = useRef<{ eol: 'lf' | 'crlf'; bom: boolean; noHead: boolean }>({ eol: 'lf', bom: false, noHead: false });
  const dirtyRels = useRef(new Set<string>());
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  const markDirty = (r: string, on: boolean) => {
    if (dirtyRels.current.has(r) === on) return;
    if (on) dirtyRels.current.add(r);
    else dirtyRels.current.delete(r);
    setDirtySet(new Set(dirtyRels.current));
  };
  const reload = (r: string) => {
    cache.current.delete(r);
    if (r === shown.current) shown.current = undefined;
    setNonce((n) => n + 1);
  };
  const t0 = t;
  const closeTab = (r: string) => {
    if (dirtyRels.current.has(r) && !window.confirm(t0('viewer.discard'))) return;
    cache.current.delete(r);
    markDirty(r, false);
    if (useSessions.getState().viewer[info.id]?.tabs.length === 1) shown.current = undefined;
    useSessions.getState().closeViewer(info.id, r);
  };
  const close = () => {
    if (dirtyRels.current.size && !window.confirm(t0('viewer.discard'))) return;
    useSessions.getState().closeViewer(info.id);
  };
  const closeTabRef = useRef(closeTab);
  closeTabRef.current = closeTab;
  const closeRef = useRef(close);
  closeRef.current = close;

  // forget tabs that were closed elsewhere
  useEffect(() => {
    const open = new Set(view?.tabs.map((x) => x.rel));
    for (const r of [...cache.current.keys()]) if (!open.has(r)) cache.current.delete(r);
    for (const r of [...dirtyRels.current]) if (!open.has(r)) markDirty(r, false);
  }, [view]);

  // (re)load the file and build the editor
  useEffect(() => {
    if (!rel) return;
    if (!rev && isImage(path)) {
      // an image has no editor: park the text file we leave so its unsaved edits survive
      const left = shown.current;
      if (left && editor.current) cache.current.set(left, { state: editor.current.state, ...meta.current, mtime: mtime.current });
      shown.current = undefined;
      return;
    }
    let dead = false;
    // park the file we are leaving, bring back the one we return to
    const prev = shown.current;
    if (prev && prev !== rel && editor.current) {
      cache.current.set(prev, { state: editor.current.state, ...meta.current, mtime: mtime.current });
    }
    const hit = prev !== rel ? cache.current.get(rel) : undefined;
    if (hit && editor.current && !split.current) {
      editor.current.setState(hit.state);
      editor.current.dispatch({ effects: wrapC.current.reconfigure(wrapRef.current ? EditorView.lineWrapping : []) });
      meta.current = { eol: hit.eol, bom: hit.bom, noHead: hit.noHead };
      mtime.current = hit.mtime;
      shown.current = rel;
      dirtyRef.current = dirtyRels.current.has(rel);
      setDirty(dirtyRef.current);
      setNoHead(hit.noHead);
      setNoChange(false);
      setStale(false);
      setDoc({ state: 'ready', eol: hit.eol, bom: hit.bom, mtimeMs: hit.mtime });
      return;
    }
    // A cached editor state cannot update MergeView's original (left) document.
    // Rebuild both panes for this file, carrying any unsaved text with it.
    if (hit && split.current) textRef.current = hit.state.doc.toString();
    setDoc({ state: 'loading' });
    void (async () => {
      let r: Awaited<ReturnType<typeof api.files.read>>;
      if (rev) {
        const at = await api.files.revText(info.id, path, rev);
        const before = at === null ? await api.files.revText(info.id, path, `${rev}^`) : null;
        r = at !== null || before !== null
          ? { ok: true, text: at ?? '', eol: 'lf', bom: false, mtimeMs: 0, size: (at ?? '').length }
          : { ok: false, error: 'not-found' };
      } else r = await api.files.read(info.id, path);
      if (dead) return;
      if (!r.ok && !(r.error === 'not-found' && (mode === 'diff' || !!rev))) {
        setDoc({ state: 'error', error: r.error });
        return;
      }
      if (!r.ok) r = { ok: true, text: '', eol: 'lf', bom: false, mtimeMs: 0, size: 0 };
      const head = rev
        ? await api.files.revText(info.id, path, `${rev}^`)
        : mode === 'diff'
          ? await api.files.headText(info.id, path)
          : undefined;
      const base = head === undefined ? undefined : (head ?? '').replace(/\r\n/g, '\n');
      const language = await languageFor(baseName(path));
      if (dead || !host.current) return;
      const carried = textRef.current;
      textRef.current = undefined;
      const text = carried ?? r.text;
      mtime.current = r.mtimeMs;
      setNoHead(head === null);
      setNoChange(base !== undefined && head !== null && base === text.replace(/\r\n/g, '\n'));
      const isDirty = carried !== undefined && carried !== r.text;
      setDirty(isDirty);
      dirtyRef.current = isDirty;
      markDirty(rel, isDirty);
      meta.current = { eol: r.eol, bom: r.bom, noHead: head === null };
      setStale(false);
      const extensions: Extension[] = [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), search({ top: true }),
        theme, syntaxHighlighting(highlight), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        // a diff is for reading: editing happens in the whole file ("Open file")
        ...(rev || mode === 'diff' ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        lang.current.of(language ?? []),
        wrapC.current.of(wrapRef.current ? EditorView.lineWrapping : []),
        keymap.of([
          { key: 'Mod-s', run: () => (void save(), true) },
          { key: 'Escape', run: () => (closeRef.current(), true) },
          { key: 'Mod-w', run: () => (closeTabRef.current(rel), true) },
          ...searchKeymap, ...historyKeymap, ...defaultKeymap
        ]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          dirtyRef.current = true;
          setDirty(true);
          markDirty(rel, true);
          useSessions.getState().pinViewer(info.id, rel); // someone is editing it: it stays
        }),
        ...(base !== undefined && !sideBySide ? [unifiedMergeView({ original: base, mergeControls: false, gutter: true, collapseUnchanged: { margin: 3, minSize: 6 } })] : [])
      ];
      const state = EditorState.create({ doc: text, extensions });
      if (split.current) {
        split.current.destroy();
        split.current = undefined;
        editor.current = undefined;
      }
      if (sideBySide && base !== undefined) {
        editor.current?.destroy();
        editor.current = undefined;
        split.current = new MergeView({
          parent: host.current,
          a: { doc: base, extensions: [lineNumbers(), theme, syntaxHighlighting(highlight), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), lang.current.of(language ?? []), EditorState.readOnly.of(true), EditorView.editable.of(false)] },
          b: { doc: text, extensions },
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 6 }
        });
        editor.current = split.current.b;
      } else if (editor.current) editor.current.setState(state);
      else editor.current = new EditorView({ parent: host.current, state });
      shown.current = rel;
      setDoc({ state: 'ready', eol: r.eol, bom: r.bom, mtimeMs: r.mtimeMs });
    })();
    return () => {
      dead = true;
    };
  }, [info.id, rel, mode, nonce, sideBySide]);

  useEffect(() => () => {
    if (split.current) split.current.destroy();
    else editor.current?.destroy();
  }, []);

  // soft wrap follows the toggle; cached tabs pick it up when they come back
  useEffect(() => {
    editor.current?.dispatch({ effects: wrapC.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  const save = useCallback(async () => {
    if (rev || mode === 'diff') return;
    const ev = editor.current;
    if (!ev) return;
    const d = docRef.current;
    if (d.state !== 'ready') return;
    const r = await api.files.write(info.id, path, ev.state.doc.toString(), d.eol, d.bom, mtime.current);
    if (r.ok) {
      mtime.current = r.mtimeMs;
      dirtyRef.current = false;
      setDirty(false);
      markDirty(rel, false);
      setStale(false);
      refreshChanges(info.id); // the "Changes" button appears once the saved file differs from HEAD
      useUi.getState().toast(t('viewer.saved'));
    } else if (r.error === 'conflict') {
      setStale(true);
      useUi.getState().toast(t('viewer.conflict'), 'error');
    } else useUi.getState().toast(t('viewer.failed'), 'error');
  }, [info.id, rel, path, rev, mode, t]);
  const docRef = useRef(doc);
  docRef.current = doc;

  // follow the file on disk (an agent keeps editing it)
  useEffect(() => {
    if (!rel || !active || doc.state !== 'ready' || rev) return;
    const i = setInterval(() => {
      void api.files.stat(info.id, path).then((s) => {
        if (!s || s.mtimeMs === mtime.current) return;
        if (dirtyRef.current) setStale(true);
        else reload(rel);
      }, () => undefined);
    }, 1500);
    return () => clearInterval(i);
  }, [info.id, rel, active, doc.state, rev]);

  if (!view) return null;

  const switchMode = (m: 'file' | 'diff') => {
    if (m === mode) return;
    if (dirtyRef.current && editor.current) textRef.current = editor.current.state.doc.toString();
    cache.current.delete(rel);
    shown.current = rel; // same file, other mode: rebuild in place
    if (m === 'file') useSessions.getState().pinViewer(info.id, rel);
    useSessions.getState().openViewer(info.id, rel, m, { path, ...(rev ? { rev } : {}) });
  };
  const switchLayout = (splitView: boolean) => {
    if (splitView === sideBySide) return;
    if (dirtyRef.current && editor.current) textRef.current = editor.current.state.doc.toString();
    cache.current.delete(rel);
    shown.current = rel;
    setSideBySide(splitView);
  };
  const image = !rev && isImage(path);
  const unchanged = !image && mode === 'diff' && noChange && !stale;
  const errorText = doc.state === 'error'
    ? t(doc.error === 'binary' ? 'viewer.binary' : doc.error === 'too-large' ? 'viewer.tooLarge' : doc.error === 'not-found' ? 'viewer.notFound' : 'viewer.failed')
    : '';

  const norm = (p: string) => p.replace(/\\/g, '/');
  const fileChange = changes?.files.find((f) => norm(f.path) === norm(path));

  return (
    <aside
      data-testid="file-viewer"
      style={maximized ? undefined : { width }}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col border-l border-border bg-bg',
        maximized ? 'flex-1' : 'min-w-[280px] max-w-[70%] shrink-0'
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('viewer.resize')}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/30"
        onPointerDown={(e) => {
          if (maximized) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragWidth(width);
        }}
        onPointerMove={(e) => {
          if (dragWidth === null) return;
          const right = e.currentTarget.parentElement!.getBoundingClientRect().right;
          setDragWidth(Math.round(Math.min(1600, Math.max(280, right - e.clientX))));
        }}
        onPointerUp={() => dragWidth !== null && saveWidth(dragWidth)}
        onDoubleClick={() => saveWidth(560)}
      />
      <div role="tablist" className="flex h-8 shrink-0 overflow-x-auto border-b border-border bg-panel text-[12px]">
        {view.tabs.map((tab) => (
          <div
            key={tab.rel}
            role="tab"
            aria-selected={tab.rel === rel}
            title={tab.path ?? tab.rel}
            onClick={() => useSessions.getState().openViewer(info.id, tab.rel, tab.mode, { path: tab.path ?? tab.rel, ...(tab.rev ? { rev: tab.rev } : {}) })}
            onDoubleClick={() => useSessions.getState().pinViewer(info.id, tab.rel)}
            onAuxClick={(e) => e.button === 1 && closeTab(tab.rel)}
            className={cn(
              'group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-2',
              tab.rel === rel ? 'bg-bg text-fg' : 'text-fg-muted hover:text-fg'
            )}
          >
            <img src={iconUrl(baseName(tab.path ?? tab.rel), false)} alt="" width={14} height={14} draggable={false} />
            <span className={cn('max-w-[160px] truncate', tab.preview && 'italic')}>{baseName(tab.path ?? tab.rel)}{tab.rev ? ` @${tab.rev.slice(0, 7)}` : ''}</span>
            {dirtySet.has(tab.rel) && <span className="text-warn">●</span>}
            <button
              type="button"
              title={t('viewer.closeTab')}
              aria-label={t('viewer.closeTab')}
              onClick={(e) => { e.stopPropagation(); closeTab(tab.rel); }}
              className={cn('rounded p-0.5 hover:bg-hover', tab.rel === rel ? '' : 'invisible group-hover:visible')}
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-panel px-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-mono text-fg" title={path}>
          {path}
          {rev && <span className="ml-1 text-fg-muted">@{rev.slice(0, 7)}</span>}
          {dirty && !image && <span className="ml-1 text-warn">●</span>}
        </span>
        {mode === 'diff' && !rev && !image && (
          <>
            <Button variant="ghost" size="sm" data-testid="open-file" title={t('viewer.openFileHint')} onClick={() => switchMode('file')}>
              <FileText size={12} />
              {t('viewer.openFile')}
            </Button>
          </>
        )}
        {mode === 'file' && !rev && !image && fileChange && (
          <Button variant="ghost" size="sm" data-testid="view-changes" title={t('viewer.viewChangesHint')} onClick={() => switchMode('diff')} className="text-warn">
            <FileDiff size={12} />
            {t('viewer.viewChanges')}
            {(fileChange.added > 0 || fileChange.deleted > 0) && (
              <span className="font-mono text-[10px]">
                <span className="text-ok">+{fileChange.added}</span> <span className="text-danger">−{fileChange.deleted}</span>
              </span>
            )}
          </Button>
        )}
        {(mode === 'diff' || !!rev) && !image && (
          <div role="group" aria-label={t('viewer.layout')} className="flex shrink-0 items-center rounded border border-border p-0.5">
            {([false, true] as const).map((side) => (
              <button
                key={String(side)}
                type="button"
                data-testid={side ? 'layout-side-by-side' : 'layout-inline'}
                aria-label={t(side ? 'viewer.sideBySide' : 'viewer.inline')}
                aria-pressed={sideBySide === side}
                title={t(side ? 'viewer.sideBySide' : 'viewer.inline')}
                onClick={() => switchLayout(side)}
                className={cn('rounded p-1', sideBySide === side ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg')}
              >
                {side ? <Columns2 size={13} /> : <Rows2 size={13} />}
              </button>
            ))}
          </div>
        )}
        <Button variant="ghost" size="sm" title={t('viewer.insertPath')} aria-label={t('viewer.insertPath')} onClick={() => insertText(info.id, refOf(path.replace(/\\/g, '/')))}>
          <AtSign size={12} />
        </Button>
        {!image && mode === 'file' && !rev && (
          <Button variant="ghost" size="sm" disabled={!dirty} title={`${t('viewer.save')} (${kbd('Mod+S')})`} aria-label={t('viewer.save')} onClick={() => void save()}>
            <Save size={12} />
          </Button>
        )}
        {!image && (
          <Button variant="ghost" size="sm" title={t('viewer.wrap')} aria-label={t('viewer.wrap')} aria-pressed={wrap} onClick={() => setWrap((v) => !v)} className={cn(wrap && 'bg-hover')}>
            <WrapText size={12} />
          </Button>
        )}
        <Button variant="ghost" size="sm" title={t(maximized ? 'viewer.restore' : 'viewer.maximize')} aria-label={t(maximized ? 'viewer.restore' : 'viewer.maximize')} onClick={() => setMaximized(!maximized)}>
          {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </Button>
      </div>
      {!image && (stale || noHead) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-panel px-3 py-1 text-[11px] text-warn">
          <span className="flex-1">{stale ? t('viewer.changed') : t('viewer.noHead')}</span>
          {stale && (
            <Button variant="outline" size="sm" onClick={() => { dirtyRef.current = false; markDirty(rel, false); reload(rel); }}>
              {t('viewer.reload')}
            </Button>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={host} className={cn('absolute inset-0 overflow-auto [&_.cm-mergeView]:h-full [&_.cm-mergeView]:min-w-[560px]', (image || unchanged || doc.state !== 'ready') && 'invisible')} />
        {image && <ImageView key={rel} sessionId={info.id} rel={path} active={active} />}
        {unchanged && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{t('viewer.noChanges')}</div>}
        {!image && doc.state === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{t('viewer.loading')}</div>}
        {!image && doc.state === 'error' && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{errorText}</div>}
      </div>
    </aside>
  );
}
