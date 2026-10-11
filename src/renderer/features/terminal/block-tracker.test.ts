import { Terminal } from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { blockText, type CommandBlock } from '@shared/types/block';
import { encodeB64 } from '@shared/osc/protocol';
import { BlockTracker } from './block-tracker';

const N = 'nonce1';
const ESC = '\x1b';
const mark = (k: string, extra = '') => `${ESC}]133;${k}${extra};aid=${N}\x07`;
const cmd = (id: number, text: string) => `${ESC}]6973;${N};cmd;${id};${encodeB64(text)}\x07`;
const hello = `${ESC}]6973;${N};hello;bash;5;1\x07`;
const clear = `${ESC}[H${ESC}[2J${ESC}[3J`;

function setup(cols = 40, rows = 10) {
  const term = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
  const finished: CommandBlock[] = [];
  const started: CommandBlock[] = [];
  const tracker = new BlockTracker(
    term,
    { sessionId: 's1', nonce: N, env: { kind: 'wsl', distro: 'Ubuntu' }, shell: 'bash' },
    { onBlockStarted: (b) => started.push(b), onBlockFinished: (b) => finished.push(b) }
  );
  const write = (d: string) => new Promise<void>((r) => term.write(d, r));
  return { term, tracker, finished, started, write };
}

/** One shell cycle as the integration scripts emit it. */
const cycle = (id: number, text: string, output: string, exit = 0) =>
  mark('A') + mark('B') + `$ ${text}\r\n` + cmd(id, text) + mark('C') + output + mark('D', `;${exit}`) + clear;

describe('BlockTracker', () => {
  it('captures output between C and D and ignores the echoed command line', async () => {
    const { write, finished, started } = setup();
    await write(hello + cycle(1, 'echo hi', 'hi\r\n'));
    expect(started).toHaveLength(1);
    expect(finished).toHaveLength(1);
    const b = finished[0]!;
    expect(b.command).toBe('echo hi');
    expect(b.status).toBe('success');
    expect(blockText(b.output)).toBe('hi');
  });

  it('keeps every block separate and in order across clears', async () => {
    const { write, finished } = setup();
    await write(hello);
    await write(cycle(1, 'a', 'one\r\ntwo\r\n'));
    await write(cycle(2, 'b', 'three\r\n', 4));
    await write(cycle(3, 'c', ''));
    expect(finished.map((b) => blockText(b.output))).toEqual(['one\ntwo', 'three', '']);
    expect(finished.map((b) => b.exitCode)).toEqual([0, 4, 0]);
    expect(finished.map((b) => b.status)).toEqual(['success', 'failed', 'success']);
  });

  it('captures output that has no trailing newline', async () => {
    const { write, finished } = setup();
    await write(hello + cycle(1, 'printf x', 'no-newline'));
    expect(blockText(finished[0]!.output)).toBe('no-newline');
  });

  it('keeps ANSI colours as styles and joins wrapped rows into one logical line', async () => {
    const { write, finished } = setup(10, 10);
    const long = 'abcdefghijklmnopqrstuvwxyz';
    await write(hello + cycle(1, 'x', `${ESC}[31mred${ESC}[0m plain\r\n${long}\r\n`));
    const out = finished[0]!.output!;
    expect(out.lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['red plain', long]);
    const redRun = out.lines[0]!.runs[0]!;
    expect(out.styles[redRun.style]!.fg).toBe('p1');
  });

  it('keeps long output beyond one screen from the scrollback', async () => {
    const { write, finished } = setup(40, 5);
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    await write(hello + cycle(1, 'seq', lines.join('\r\n') + '\r\n'));
    const out = finished[0]!.output!;
    expect(out.truncated).toBe(false);
    expect(out.lines).toHaveLength(200);
    expect(out.lines[199]!.runs[0]!.text).toBe('line 199');
  });

  it('marks output as truncated when it scrolled out of the scrollback', async () => {
    const term = new Terminal({ cols: 20, rows: 4, scrollback: 10, allowProposedApi: true });
    const done: CommandBlock[] = [];
    new BlockTracker(term, { sessionId: 's', nonce: N, env: { kind: 'windows' }, shell: 'pwsh' }, {
      onBlockStarted: () => {}, onBlockFinished: (b) => done.push(b)
    });
    const lines = Array.from({ length: 100 }, (_, i) => `row ${i}`).join('\r\n') + '\r\n';
    await new Promise<void>((r) => term.write(hello + cycle(1, 'big', lines), r));
    expect(done[0]!.output!.truncated).toBe(true);
    expect(blockText(done[0]!.output)).toContain('row 99');
  });

  it('preserves Thai text with combining marks in one cell sequence', async () => {
    const { write, finished } = setup();
    const thai = 'สวัสดี น้ำ ผู้ใหญ่ ที่นี่ กำลัง ฤๅษี';
    await write(hello + cycle(1, 'echo thai', thai + '\r\n'));
    expect(blockText(finished[0]!.output)).toBe(thai);
  });

  it('records alternate-screen use and only the normal buffer content', async () => {
    const { write, finished } = setup();
    await write(hello + mark('A') + mark('B') + cmd(1, 'vim') + mark('C') +
      `before\r\n${ESC}[?1049h${ESC}[HIN-VIM${ESC}[?1049l` + mark('D', ';0') + clear);
    expect(finished[0]!.usedAltScreen).toBe(true);
    expect(blockText(finished[0]!.output)).toBe('before');
  });

  it('ignores forged sequences that lack the session nonce', async () => {
    const { write, finished, started } = setup();
    await write(hello + `${ESC}]133;C;aid=wrong\x07${ESC}]133;D;0;aid=wrong\x07`);
    expect(started).toHaveLength(0);
    expect(finished).toHaveLength(0);
  });

  it('turns a block that never got D into an unknown block when a new prompt starts', async () => {
    const { write, finished } = setup();
    await write(hello + mark('A') + mark('B') + cmd(1, 'exec zsh') + mark('C') + 'bye\r\n' + mark('A'));
    expect(finished[0]!.status).toBe('unknown');
  });

  it('keeps the terminal buffer coherent when output is split across arbitrary chunks', async () => {
    const { write, finished } = setup();
    const stream = hello + cycle(1, 'e', 'ก็อบปี้ สวัสดี\r\n' + 'x'.repeat(90) + '\r\n') + cycle(2, 'f', 'two\r\n');
    for (let i = 0; i < stream.length; i += 7) await write(stream.slice(i, i + 7));
    expect(finished.map((b) => b.command)).toEqual(['e', 'f']);
    expect(blockText(finished[1]!.output)).toBe('two');
    expect(finished[0]!.output!.lines).toHaveLength(2);
  });

  it('keeps the prompt and the echoed command (with colours) as the block header, taken before the screen is wiped', async () => {
    const { write, started, finished } = setup(40, 6);
    await write(hello + mark('A') + mark('B') + `${ESC}[32m>${ESC}[0m proj $ ls\r\n` + cmd(1, 'ls') + clear + mark('C') + 'a b\r\n' + mark('D', ';0') + clear);
    const p = started[0]!.prompt!;
    expect(blockText(p)).toBe('> proj $ ls');
    expect(p.styles[p.lines[0]!.runs[0]!.style]!.fg).toBe('p2');
    expect(finished[0]!.prompt).toEqual(p);
    expect(blockText(finished[0]!.output)).toBe('a b');
  });

  it('reads the prompt that is waiting for input', async () => {
    const { write, tracker } = setup(40, 6);
    await write(hello + mark('A') + mark('B') + `line one\r\n> `);
    expect(blockText(tracker.promptSnapshot())).toBe('line one\n>');
  });

  it('drops the spaces a shell pads the prompt line with, so the prompt is as wide as its text', async () => {
    const { write, tracker } = setup(40, 6);
    await write(hello + mark('A') + mark('B') + '> proj' + ' '.repeat(30) + '\r\x1b[7C');
    expect(blockText(tracker.promptSnapshot())).toBe('> proj');
  });
});
