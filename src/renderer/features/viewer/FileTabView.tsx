import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { AtSign, Columns2, FileDiff, FileText, Rows2, Save, WrapText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { kbd } from '@/lib/platform';
import { useEditors, parkedText } from '@/stores/editors';
import { useGitEpoch, useGitExternalEpoch } from '@/stores/git-sync';
import { useLayout, type FileTab } from '@/stores/layout';
import { useUi } from '@/stores/ui';
import { insertText, refOf } from '../agents/insert';
import { refreshChanges, useChanges } from '../agents/useChanges';
import { requestCloseTab } from '../layout/actions';
import { editorHighlight, editorTheme, defaultHighlightStyle, syntaxHighlighting } from './editor-theme';
import { ImageView, isImage } from './ImageView';
import { languageFor } from './language';

const baseName = (rel: string) => rel.replace(/\\/g, '/').split('/').at(-1) ?? rel;

type Doc =
  | { state: 'loading' }
  | { state: 'error'; error: 'too-large' | 'binary' | 'not-found' | 'denied' | 'failed' }
  | { state: 'ready'; eol: 'lf' | 'crlf'; bom: boolean; mtimeMs: number };

/**
 * One file of a session's folder as a tab of the grid: as it is (and editable) or as the difference against HEAD.
 * A file an agent is changing is reloaded when it changes on disk, unless it has unsaved edits here. Unsaved text
 * survives the tab being moved to another group or hidden behind another tab.
 */
export function FileTabView({ tab, info }: { tab: FileTab; info: SessionInfo }) {
  const t = useT();
  const { key, rel, mode, rev } = tab;
  const path = tab.path ?? rel;
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | undefined>(undefined);
  const split = useRef<MergeView | undefined>(undefined);
  const [sideBySide, setSideBySide] = useState(false);
  const lang = useRef(new Compartment());
  const wrapC = useRef(new Compartment());
  const [doc, setDoc] = useState<Doc>({ state: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [noHead, setNoHead] = useState(false);
  const [noChange, setNoChange] = useState(false);
  const [wrap, setWrap] = useState(true);
  const wrapRef = useRef(true);
  wrapRef.current = wrap;
  const [nonce, setNonce] = useState(0); // bumped to load the file again
  const mtime = useRef(0);
  const dirtyRef = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const parked = parkedText.get(key);
  // unsaved text carried over when only the mode changes, or when this tab was moved or hidden
  const textRef = useRef<string | undefined>(parked && parked.mode === mode ? parked.text : undefined);
  const changes = useChanges(info.id, true);

  const setDirtyBoth = (on: boolean) => {
    dirtyRef.current = on;
    setDirty(on);
    useEditors.getState().setDirty(key, on);
  };
  const reload = () => setNonce((n) => n + 1);

  // the repository moved on (a switch, pull or reset here or elsewhere): a file without edits is read again, one with edits is kept
  const gitEpoch = useGitEpoch(info.id);
  const externalEpoch = useGitExternalEpoch(info.id);
  const seenEpoch = useRef({ any: gitEpoch, external: externalEpoch });
  useEffect(() => {
    const external = externalEpoch !== seenEpoch.current.external;
    if (gitEpoch === seenEpoch.current.any && !external) return;
    seenEpoch.current = { any: gitEpoch, external: externalEpoch };
    if (rev) return; // a commit's own view never changes
    if (!dirtyRef.current) reload();
    else if (external) setStale(true); // the text on screen may not match the new branch; it stays as it is
  }, [gitEpoch, externalEpoch]);

  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const docRef = useRef(doc);
  docRef.current = doc;

  // (re)load the file and build the editor
  useEffect(() => {
    if (!rev && isImage(path)) return;
    let dead = false;
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
      parkedText.delete(key);
      const text = carried ?? r.text;
      mtime.current = r.mtimeMs;
      setNoHead(head === null);
      setNoChange(base !== undefined && head !== null && base === text.replace(/\r\n/g, '\n'));
      setDirtyBoth(carried !== undefined && carried !== r.text);
      setStale(false);
      const extensions: Extension[] = [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), search({ top: true }),
        editorTheme, syntaxHighlighting(editorHighlight), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        // a diff is for reading: editing happens in the whole file ("Open file")
        ...(rev || mode === 'diff' ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        lang.current.of(language ?? []),
        wrapC.current.of(wrapRef.current ? EditorView.lineWrapping : []),
        keymap.of([
          { key: 'Mod-s', run: () => (void saveRef.current(), true) },
          { key: 'Escape', run: () => (requestCloseTab(key), true) },
          { key: 'Mod-w', run: () => (requestCloseTab(key), true) },
          ...searchKeymap, ...historyKeymap, ...defaultKeymap
        ]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          setDirtyBoth(true);
          useLayout.getState().pinFile(key); // someone is editing it: it stays
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
          a: { doc: base, extensions: [lineNumbers(), editorTheme, syntaxHighlighting(editorHighlight), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), lang.current.of(language ?? []), EditorState.readOnly.of(true), EditorView.editable.of(false)] },
          b: { doc: text, extensions },
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 6 }
        });
        editor.current = split.current.b;
      } else if (editor.current) editor.current.setState(state);
      else editor.current = new EditorView({ parent: host.current, state });
      setDoc({ state: 'ready', eol: r.eol, bom: r.bom, mtimeMs: r.mtimeMs });
    })();
    return () => {
      dead = true;
    };
  }, [info.id, rel, mode, nonce, sideBySide]);

  // leaving the screen (tab moved, hidden or closed): unsaved text is kept for the next time, unless the tab is gone
  useEffect(() => () => {
    const open = !!useLayout.getState().tabs[key] && !!useEditors.getState().dirty[key];
    if (open && editor.current) parkedText.set(key, { text: editor.current.state.doc.toString(), mode: modeRef.current });
    if (split.current) split.current.destroy();
    else editor.current?.destroy();
  }, []);

  // soft wrap follows the toggle
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
      setDirtyBoth(false);
      setStale(false);
      refreshChanges(info.id); // the "Changes" button appears once the saved file differs from HEAD
      useUi.getState().toast(t('viewer.saved'));
    } else if (r.error === 'conflict') {
      setStale(true);
      useUi.getState().toast(t('viewer.conflict'), 'error');
    } else useUi.getState().toast(t('viewer.failed'), 'error');
  }, [info.id, key, path, rev, mode, t]);
  saveRef.current = save;

  // follow the file on disk (an agent keeps editing it)
  useEffect(() => {
    if (doc.state !== 'ready' || rev) return;
    const i = setInterval(() => {
      void api.files.stat(info.id, path).then((s) => {
        if (!s || s.mtimeMs === mtime.current) return;
        if (dirtyRef.current) setStale(true);
        else reload();
      }, () => undefined);
    }, 1500);
    return () => clearInterval(i);
  }, [info.id, path, doc.state, rev]);

  const switchMode = (m: 'file' | 'diff') => {
    if (m === mode) return;
    if (dirtyRef.current && editor.current) textRef.current = editor.current.state.doc.toString();
    if (m === 'file') useLayout.getState().pinFile(key);
    useLayout.getState().setMode(key, m);
  };
  const switchLayout = (splitView: boolean) => {
    if (splitView === sideBySide) return;
    if (dirtyRef.current && editor.current) textRef.current = editor.current.state.doc.toString();
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
    <div data-testid="file-viewer" className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-panel px-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-mono text-fg" title={path}>
          {path}
          {rev && <span className="ml-1 text-fg-muted">@{rev.slice(0, 7)}</span>}
          {dirty && !image && <span className="ml-1 text-warn">●</span>}
        </span>
        {mode === 'diff' && !rev && !image && (
          <Button variant="ghost" size="sm" data-testid="open-file" title={t('viewer.openFileHint')} onClick={() => switchMode('file')}>
            <FileText size={12} />
            {t('viewer.openFile')}
          </Button>
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
      </div>
      {!image && (stale || noHead) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-panel px-3 py-1 text-[11px] text-warn">
          <span className="flex-1">{stale ? t('viewer.changed') : t('viewer.noHead')}</span>
          {stale && (
            <Button variant="outline" size="sm" onClick={() => { setDirtyBoth(false); reload(); }}>
              {t('viewer.reload')}
            </Button>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={host} className={cn('absolute inset-0 overflow-auto [&_.cm-mergeView]:h-full [&_.cm-mergeView]:min-w-[560px]', (image || unchanged || doc.state !== 'ready') && 'invisible')} />
        {image && <ImageView key={rel} sessionId={info.id} rel={path} active />}
        {unchanged && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{t('viewer.noChanges')}</div>}
        {!image && doc.state === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{t('viewer.loading')}</div>}
        {!image && doc.state === 'error' && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{errorText}</div>}
      </div>
    </div>
  );
}
