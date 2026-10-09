import { describe, expect, it } from 'vitest';
import { clearLineInput, encodeSubmit, submitSteps, wrapMultiline } from './submit';

describe('command submission', () => {
  it('clears the shell input line, then types the command and presses Enter', () => {
    expect(encodeSubmit('bash', 'ls -la')).toBe('\x15ls -la\r');
    expect(encodeSubmit('zsh', 'echo สวัสดี')).toBe('\x15echo สวัสดี\r');
    expect(encodeSubmit('pwsh', 'dir')).toBe('\x1bdir\r');
    expect(clearLineInput('powershell')).toBe('\x1b');
  });

  it('sends multi-line commands to zsh as one bracketed paste and drops trailing newlines', () => {
    expect(encodeSubmit('zsh', 'echo a\r\necho b\n\n')).toBe('\x15\x1b[200~echo a\necho b\x1b[201~\r');
  });

  it('sends multi-line commands to bash and PowerShell as one decodable line', () => {
    const text = 'echo "ไทย it\'s"\necho b';
    const b = Buffer.from(text).toString('base64');
    expect(wrapMultiline('bash', text)).toBe(`eval "$(printf %s '${b}' | base64 -d)"`);
    expect(wrapMultiline('pwsh', text)).toBe(`. (__ad_sb '${b}')`);
    expect(wrapMultiline('zsh', text)).toBeUndefined();
    expect(encodeSubmit('bash', text + '\n')).toBe(`\x15eval "$(printf %s '${b}' | base64 -d)"\r`);
    expect(encodeSubmit('powershell', text)).toBe(`\x1b. (__ad_sb '${b}')\r`);
    expect(encodeSubmit('bash', text)).not.toContain('\n');
  });

  it('writes the PowerShell clear first and the command shortly after (ESC + letter would be Alt+letter)', () => {
    const steps = submitSteps('pwsh', 'echo hi');
    expect(steps).toEqual([{ data: '\x1b', delayMs: 0 }, { data: 'echo hi\r', delayMs: 40 }]);
    expect(submitSteps('bash', 'echo hi')).toEqual([{ data: '\x15echo hi\r', delayMs: 0 }]);
  });
});
