import type { ShellKind } from '../types/env';

export interface Token {
  /** UTF-16 range in the original line, including any quote characters. */
  start: number;
  end: number;
  /** Text as typed. */
  raw: string;
  /** Text with quotes and escapes resolved. */
  value: string;
  quote: '' | "'" | '"';
  /** The closing quote has not been typed yet. */
  open: boolean;
}

export interface TokenizedLine {
  tokens: Token[];
  /** Token under the cursor; an empty token is synthesised when the cursor sits between words. */
  current: Token;
  /** Index of `current` in `tokens` (== tokens.length when synthesised). */
  index: number;
  /** Index of the first word of the simple command that contains the cursor. */
  commandIndex: number;
  /** Resolved words of the current simple command, up to and including `current`. */
  words: string[];
  isCommandPosition: boolean;
}

const isPs = (s: ShellKind) => s === 'pwsh' || s === 'powershell';

/** Splits a line the way the given shell would, tolerating unfinished quotes (the user is still typing). */
export function tokenize(line: string, cursor: number, shell: ShellKind): TokenizedLine {
  const ps = isPs(shell);
  const escape = ps ? '`' : '\\';
  const tokens: Token[] = [];
  let i = 0;
  const head = line.slice(0, cursor);
  const n = head.length;
  let cmdStart = 0;
  const cmdStarts: number[] = [0];

  while (i < n) {
    const ch = head[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&') {
      let j = i + 1;
      while (j < n && (head[j] === '|' || head[j] === '&')) j++;
      cmdStart = tokens.length;
      cmdStarts.push(cmdStart);
      i = j;
      continue;
    }
    const start = i;
    let value = '';
    let quote: Token['quote'] = '';
    let open = false;
    while (i < n) {
      const c = head[i]!;
      if (quote) {
        if (c === quote) {
          if (ps && head[i + 1] === quote) {
            value += quote; // '' inside single quotes (and "" inside double quotes) is a literal quote
            i += 2;
            continue;
          }
          quote = '';
          i++;
          continue;
        }
        if (c === escape && quote === '"' && i + 1 < n) {
          value += head[i + 1]!;
          i += 2;
          continue;
        }
        value += c;
        i++;
        continue;
      }
      if (/\s/.test(c) || c === ';' || c === '|' || c === '&' || c === '<' || c === '>') break;
      if (c === "'" || c === '"') {
        quote = c;
        i++;
        continue;
      }
      if (c === escape && i + 1 < n) {
        value += head[i + 1]!;
        i += 2;
        continue;
      }
      value += c;
      i++;
    }
    if (quote) open = true;
    // The quote kind decides how a completion is inserted into this token.
    const first = head[start];
    const quoteKind: Token['quote'] = open ? quote : first === "'" || first === '"' ? first : '';
    tokens.push({ start, end: i, raw: head.slice(start, i), value, quote: quoteKind, open });
  }

  const last = tokens[tokens.length - 1];
  const atWordEnd = last !== undefined && last.end === cursor && !(/\s/.test(head[cursor - 1] ?? ' ') && !last.open);
  let current: Token;
  let index: number;
  if (last && atWordEnd) {
    current = last;
    index = tokens.length - 1;
  } else {
    current = { start: cursor, end: cursor, raw: '', value: '', quote: '', open: false };
    index = tokens.length;
    // a separator right before the cursor starts a new command
    const trimmed = head.trimEnd();
    if (/[;|&]$/.test(trimmed)) cmdStarts.push(tokens.length);
  }
  const commandIndex = [...cmdStarts].reverse().find((s) => s <= index) ?? 0;
  const words = [...tokens.slice(commandIndex, index).map((t) => t.value), current.value];
  return { tokens, current, index, commandIndex, words, isCommandPosition: index === commandIndex };
}

/** Quotes a path or name for insertion into a command line of the given shell. */
export function quoteForShell(value: string, shell: ShellKind, openQuote: Token['quote'], opts: { closeQuote: boolean }): string {
  if (openQuote) {
    const esc = isPs(shell) ? value.split(openQuote).join(openQuote + openQuote) : value;
    return opts.closeQuote ? esc + openQuote : esc;
  }
  if (isPs(shell)) {
    return /[\s'"`$(){}\[\];,&|<>@#]/.test(value) ? `'${value.replace(/'/g, "''")}'` : value;
  }
  return value.replace(/[\s'"\\$`()<>|&;*?#~!{}\[\]]/g, (m) => `\\${m}`);
}
