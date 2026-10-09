import type { ShellKind } from '@shared/types/env';

const BP_START = '\x1b[200~';
const BP_END = '\x1b[201~';

/** Keystrokes that clear whatever is typed on the shell's own input line. */
export function clearLineInput(shell: ShellKind): string {
  return shell === 'pwsh' || shell === 'powershell' ? '\x1b' : '\x15';
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/**
 * One-line form of a multi-line command that the shell decodes and runs in its current scope (so variables,
 * functions and `cd` persist). The integration scripts recognise these two shapes, report the original text
 * as the command and keep the wrapper out of the shell's history.
 *  - PowerShell:  . (__ad_sb 'BASE64')
 *  - bash:        eval "$(printf %s 'BASE64' | base64 -d)"
 * Why not paste the lines: bash would run each pasted line as its own command (two PS0 hooks, one prompt), and
 * PowerShell receives no bracketed paste through ConPTY, so the lines arrive out of order. zsh keeps the whole
 * buffer as one command, so a bracketed paste is exact there.
 */
export function wrapMultiline(shell: ShellKind, text: string): string | undefined {
  if (shell === 'pwsh' || shell === 'powershell') return `. (__ad_sb '${b64(text)}')`;
  if (shell === 'bash') return `eval "$(printf %s '${b64(text)}' | base64 -d)"`;
  return undefined;
}

/**
 * Bytes written to the PTY to run `command` as if typed.
 */
export function encodeSubmit(shell: ShellKind, command: string): string {
  const text = command.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!text.includes('\n')) return clearLineInput(shell) + text + '\r';
  const wrapped = wrapMultiline(shell, text);
  if (wrapped) return clearLineInput(shell) + wrapped + '\r';
  return clearLineInput(shell) + BP_START + text + BP_END + '\r';
}

/**
 * PSReadLine clears a line with a lone ESC, and ESC immediately followed by a character
 * is read as Alt+<char> (the first letter of the command would be lost). For PowerShell the
 * clear is therefore written first and the command a moment later.
 */
export function submitSteps(shell: ShellKind, command: string): { data: string; delayMs: number }[] {
  const full = encodeSubmit(shell, command);
  if (shell === 'pwsh' || shell === 'powershell') {
    const clear = clearLineInput(shell);
    return [{ data: clear, delayMs: 0 }, { data: full.slice(clear.length), delayMs: 40 }];
  }
  return [{ data: full, delayMs: 0 }];
}
