import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--ad-bg)', color: 'var(--ad-fg)', fontSize: '12.5px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, "Roboto Mono", monospace)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--ad-accent)' },
  '.cm-gutters': { backgroundColor: 'var(--ad-panel)', color: 'var(--ad-fg-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--ad-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ad-hover)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--ad-accent) 28%, transparent)' },
  '.cm-changedLine': { backgroundColor: 'rgba(123,198,143,0.14)' },
  '.cm-deletedChunk': { backgroundColor: 'rgba(229,115,107,0.12)' },
  '.cm-insertedLine, .cm-deletedLine': { textDecoration: 'none' },
  '.cm-changedText': { backgroundColor: 'rgba(123,198,143,0.3)' },
  '.cm-deletedChunk .cm-deletedText': { backgroundColor: 'rgba(229,115,107,0.32)' },
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
export const editorHighlight = HighlightStyle.define([
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


export { defaultHighlightStyle, syntaxHighlighting };
