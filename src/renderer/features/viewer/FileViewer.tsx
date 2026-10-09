import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { AtSign, Save, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { insertText, refOf } from '../agents/insert';
import { languageFor } from './language';

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--ad-bg)', color: 'var(--ad-fg)', fontSize: '12.5px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', lineHeight: '1.55' },
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
  '.cm-panels': { backgroundColor: 'var(--ad-panel)', color: 'var(--ad-fg)' }
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
  const rel = view?.rel ?? '';
  const mode = view?.mode ?? 'file';
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | undefined>(undefined);
  const lang = useRef(new Compartment());
  const [doc, setDoc] = useState<Doc>({ state: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [noHead, setNoHead] = useState(false);
  const [nonce, setNonce] = useState(0); // bumped to load the file again
  const mtime = useRef(0);
  const dirtyRef = useRef(false);
  const textRef = useRef<string | undefined>(undefined); // unsaved text carried over when only the mode changes

  const close = () => useSessions.getState().closeViewer(info.id);

  // (re)load the file and build the editor
  useEffect(() => {
    if (!rel) return;
    let dead = false;
    setDoc({ state: 'loading' });
    void (async () => {
      const r = await api.files.read(info.id, rel);
      if (dead) return;
      if (!r.ok) {
        setDoc({ state: 'error', error: r.error });
        return;
      }
      const head = mode === 'diff' ? await api.files.headText(info.id, rel) : undefined;
      const base = head === undefined ? undefined : (head ?? '').replace(/\r\n/g, '\n');
      const language = await languageFor(baseName(rel));
      if (dead || !host.current) return;
      const carried = textRef.current;
      textRef.current = undefined;
      const text = carried ?? r.text;
      mtime.current = r.mtimeMs;
      setNoHead(head === null);
      setDirty(carried !== undefined && carried !== r.text);
      dirtyRef.current = carried !== undefined && carried !== r.text;
      setStale(false);
      const extensions: Extension[] = [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), search({ top: true }),
        theme, syntaxHighlighting(highlight), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        lang.current.of(language ?? []),
        keymap.of([
          { key: 'Mod-s', run: () => (void save(), true) },
          { key: 'Escape', run: () => (close(), true) },
          ...searchKeymap, ...historyKeymap, ...defaultKeymap
        ]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          dirtyRef.current = true;
          setDirty(true);
        }),
        ...(base !== undefined ? [unifiedMergeView({ original: base, mergeControls: false, gutter: true })] : [])
      ];
      editor.current?.destroy();
      editor.current = new EditorView({ parent: host.current, state: EditorState.create({ doc: text, extensions }) });
      setDoc({ state: 'ready', eol: r.eol, bom: r.bom, mtimeMs: r.mtimeMs });
    })();
    return () => {
      dead = true;
    };
  }, [info.id, rel, mode, nonce]);

  useEffect(() => () => editor.current?.destroy(), []);

  const save = useCallback(async () => {
    const ev = editor.current;
    if (!ev) return;
    const d = docRef.current;
    if (d.state !== 'ready') return;
    const r = await api.files.write(info.id, rel, ev.state.doc.toString(), d.eol, d.bom, mtime.current);
    if (r.ok) {
      mtime.current = r.mtimeMs;
      dirtyRef.current = false;
      setDirty(false);
      setStale(false);
      useUi.getState().toast(t('viewer.saved'));
    } else if (r.error === 'conflict') {
      setStale(true);
      useUi.getState().toast(t('viewer.conflict'), 'error');
    } else useUi.getState().toast(t('viewer.failed'), 'error');
  }, [info.id, rel, t]);
  const docRef = useRef(doc);
  docRef.current = doc;

  // follow the file on disk (an agent keeps editing it)
  useEffect(() => {
    if (!rel || !active || doc.state !== 'ready') return;
    const i = setInterval(() => {
      void api.files.stat(info.id, rel).then((s) => {
        if (!s || s.mtimeMs === mtime.current) return;
        if (dirtyRef.current) setStale(true);
        else setNonce((n) => n + 1);
      }, () => undefined);
    }, 1500);
    return () => clearInterval(i);
  }, [info.id, rel, active, doc.state]);

  if (!view) return null;

  const switchMode = (m: 'file' | 'diff') => {
    if (m === mode) return;
    if (dirtyRef.current && editor.current) textRef.current = editor.current.state.doc.toString();
    useSessions.getState().openViewer(info.id, rel, m);
  };
  const errorText = doc.state === 'error'
    ? t(doc.error === 'binary' ? 'viewer.binary' : doc.error === 'too-large' ? 'viewer.tooLarge' : doc.error === 'not-found' ? 'viewer.notFound' : 'viewer.failed')
    : '';

  return (
    <aside data-testid="file-viewer" className="flex min-h-0 w-[min(46%,720px)] min-w-[320px] shrink-0 flex-col border-l border-border bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-panel px-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-mono text-fg" title={rel}>
          {rel}
          {dirty && <span className="ml-1 text-warn">●</span>}
        </span>
        {(['file', 'diff'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={cn('rounded px-2 py-0.5', mode === m ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg')}
          >
            {t(m === 'file' ? 'viewer.file' : 'viewer.diff')}
          </button>
        ))}
        <Button variant="ghost" size="sm" title={t('viewer.insertPath')} aria-label={t('viewer.insertPath')} onClick={() => insertText(info.id, refOf(rel.replace(/\\/g, '/')))}>
          <AtSign size={12} />
        </Button>
        <Button variant="ghost" size="sm" disabled={!dirty} title={`${t('viewer.save')} (Ctrl+S)`} aria-label={t('viewer.save')} onClick={() => void save()}>
          <Save size={12} />
        </Button>
        <Button variant="ghost" size="sm" title={t('viewer.close')} aria-label={t('viewer.close')} onClick={close}>
          <X size={12} />
        </Button>
      </div>
      {(stale || noHead) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-panel px-3 py-1 text-[11px] text-warn">
          <span className="flex-1">{stale ? t('viewer.changed') : t('viewer.noHead')}</span>
          {stale && (
            <Button variant="outline" size="sm" onClick={() => { dirtyRef.current = false; setNonce((n) => n + 1); }}>
              {t('viewer.reload')}
            </Button>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={host} className={cn('absolute inset-0', doc.state !== 'ready' && 'invisible')} />
        {doc.state === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{t('viewer.loading')}</div>}
        {doc.state === 'error' && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{errorText}</div>}
      </div>
    </aside>
  );
}
