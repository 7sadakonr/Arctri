import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CompletionItem } from '@shared/types/completion';
import { api } from '@/lib/api';
import { FOCUS_SESSION_EVENT } from '@/lib/focus';
import { tNow, useT } from '@/lib/i18n';
import { useBlocks } from '@/stores/blocks';
import { useUi } from '@/stores/ui';
import { INSERT_EVENT } from '../agents/insert';
import { AutocompleteOverlay } from './AutocompleteOverlay';

const drafts = new Map<string, string>();
let requestSeq = 0;

export function applyCompletion(line: string, item: CompletionItem): { text: string; caret: number } {
  const [start, end] = item.replace;
  const text = line.slice(0, start) + item.insertText + line.slice(end);
  return { text, caret: start + item.insertText.length };
}

export function CommandEditor({ sessionId, focused }: { sessionId: string; focused: boolean }) {
  const t = useT();
  const [text, setText] = useState(() => drafts.get(sessionId) ?? '');
  const [items, setItems] = useState<CompletionItem[]>([]);
  const [selected, setSelected] = useState(-1);
  const [ghost, setGhost] = useState('');
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);
  const history = useRef<{ list: string[] | undefined; index: number; draft: string }>({ list: undefined, index: -1, draft: '' });
  const caretAfter = useRef<number | undefined>(undefined);

  useEffect(() => {
    drafts.set(sessionId, text);
  }, [sessionId, text]);

  useEffect(() => {
    if (focused) area.current?.focus();
  }, [focused]);

  // The file panel and the changes list put a path into the line being written.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ sessionId: string; text: string; handled?: boolean }>).detail;
      if (d.sessionId !== sessionId) return;
      d.handled = true;
      const el = area.current;
      const at = el?.selectionStart ?? text.length;
      const next = text.slice(0, at) + d.text + ' ' + text.slice(el?.selectionEnd ?? at);
      caretAfter.current = at + d.text.length + 1;
      setText(next);
      el?.focus();
    };
    window.addEventListener(INSERT_EVENT, h);
    return () => window.removeEventListener(INSERT_EVENT, h);
  }, [sessionId, text]);

  useEffect(() => {
    if (!focused) return;
    const h = () => area.current?.focus();
    window.addEventListener(FOCUS_SESSION_EVENT, h);
    return () => window.removeEventListener(FOCUS_SESSION_EVENT, h);
  }, [focused]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    if (caretAfter.current !== undefined) {
      el.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = undefined;
    }
  }, [text]);

  const query = useCallback(
    (line: string, cursor: number) => {
      clearTimeout(timer.current);
      if (!line.trim() || composing.current) {
        setItems([]);
        setGhost('');
        setOpen(false);
        return;
      }
      timer.current = setTimeout(async () => {
        const id = ++requestSeq;
        latest.current = id;
        try {
          const r = await api.completion.query({ requestId: id, sessionId, line, cursor });
          if (latest.current !== id) return; // a newer keystroke superseded this request
          setItems(r.items);
          setSelected(-1);
          setOpen(r.items.length > 0);
          setGhost(r.ghost && cursor === line.length && !line.includes('\n') && r.ghost.startsWith(line) ? r.ghost.slice(line.length) : '');
        } catch {
          setItems([]);
          setGhost('');
        }
      }, 30);
    },
    [sessionId]
  );

  const change = (value: string, cursor: number) => {
    setText(value);
    history.current.index = -1;
    query(value, cursor);
  };

  const accept = (item: CompletionItem) => {
    const el = area.current;
    const r = applyCompletion(text, item);
    caretAfter.current = r.caret;
    setText(r.text);
    setOpen(false);
    setItems([]);
    setGhost('');
    // Paths keep suggesting inside the directory that was just completed. Done at once (not deferred)
    // so it can never overwrite the suggestions of text typed afterwards.
    if (item.kind === 'dir') query(r.text, r.caret);
    el?.focus();
  };

  const submit = async () => {
    const command = text.replace(/\s+$/, '');
    if (!command.trim()) return;
    const res = await api.sessions.submit(sessionId, command);
    if (res.ok) {
      setText('');
      setItems([]);
      setGhost('');
      setOpen(false);
      history.current = { list: undefined, index: -1, draft: '' };
    } else {
      useUi.getState().toast(tNow(res.reason === 'not-at-prompt' ? 'editor.notReady' : 'editor.sendFailed'), 'error');
    }
  };

  const navigateHistory = async (dir: -1 | 1) => {
    const h = history.current;
    if (!h.list) {
      const rows = await api.history.search(sessionId, '', 200);
      h.list = rows.map((r) => r.command);
    }
    if (dir === -1) {
      if (h.index === -1) h.draft = text;
      const next = Math.min(h.list.length - 1, h.index + 1);
      if (next < 0 || next === h.index && h.index === h.list.length - 1) return;
      h.index = next;
      const v = h.list[next] ?? '';
      caretAfter.current = v.length;
      setText(v);
    } else {
      if (h.index === -1) return;
      const next = h.index - 1;
      h.index = next;
      const v = next === -1 ? h.draft : (h.list[next] ?? '');
      caretAfter.current = v.length;
      setText(v);
    }
    setOpen(false);
    setGhost('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Never act on keys that belong to an input method.
    if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
    const el = e.currentTarget;
    const atEnd = el.selectionStart === text.length && el.selectionEnd === text.length;

    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      if (open && selected >= 0 && items[selected]) accept(items[selected]!);
      else void submit();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (open && items.length > 0) accept(items[Math.max(0, selected)]!);
      else if (ghost && atEnd) change(text + ghost, text.length + ghost.length);
    } else if (e.key === 'Escape') {
      if (open || ghost) {
        e.preventDefault();
        setOpen(false);
        setGhost('');
      }
    } else if ((e.key === 'ArrowRight' || e.key === 'End') && ghost && atEnd) {
      e.preventDefault();
      caretAfter.current = text.length + ghost.length;
      change(text + ghost, text.length + ghost.length);
    } else if (e.key === 'ArrowDown' && open && items.length > 0) {
      e.preventDefault();
      setSelected((s) => (s + 1) % items.length);
    } else if (e.key === 'ArrowUp' && open && items.length > 0) {
      e.preventDefault();
      setSelected((s) => (s <= 0 ? items.length - 1 : s - 1));
    } else if (e.key === 'ArrowUp' && !e.ctrlKey && !text.slice(0, el.selectionStart).includes('\n')) {
      e.preventDefault();
      void navigateHistory(-1);
    } else if (e.key === 'ArrowDown' && !e.ctrlKey && !text.slice(el.selectionEnd).includes('\n')) {
      e.preventDefault();
      void navigateHistory(1);
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c' && el.selectionStart === el.selectionEnd) {
      e.preventDefault();
      change('', 0);
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      useBlocks.getState().drop(sessionId);
    }
  };

  return (
    <div className="relative px-3 pt-2">
      {open && <AutocompleteOverlay items={items} selected={selected} onPick={(i) => items[i] && accept(items[i]!)} />}
      <div className="relative rounded-lg border border-border bg-panel focus-within:border-accent/60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono text-[13px] leading-[1.45]"
        >
          <span className="invisible">{text}</span>
          <span className="text-fg-muted/60">{ghost}</span>
        </div>
        <textarea
          ref={area}
          data-testid="command-editor"
          value={text}
          rows={1}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          placeholder={t('editor.placeholder')}
          aria-label={t('editor.placeholder')}
          onChange={(e) => change(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            query(e.currentTarget.value, e.currentTarget.selectionStart);
          }}
          onBlur={() => setOpen(false)}
          className="relative block max-h-[168px] w-full resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-[13px] leading-[1.45] text-fg outline-none placeholder:text-fg-muted/70"
        />
      </div>
    </div>
  );
}
