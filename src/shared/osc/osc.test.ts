import { describe, expect, it } from 'vitest';
import { OscTokenizer } from './tokenizer';
import { encodeB64, parseOsc } from './protocol';

const N = 'abc123';
const osc = (body: string, term = '\x07') => `\x1b]${body}${term}`;

describe('OscTokenizer', () => {
  it('extracts BEL and ST terminated sequences', () => {
    const t = new OscTokenizer();
    const out = t.push(`hi${osc('133;A;aid=x')}text${osc('0;title', '\x1b\\')}`);
    expect(out).toEqual([
      { id: 133, payload: 'A;aid=x' },
      { id: 0, payload: 'title' }
    ]);
  });

  it('handles every possible chunk split of a sequence', () => {
    const data = `a${osc('6973;n;cwd;' + encodeB64('C:\\งาน'))}b${osc('133;D;3;aid=n', '\x1b\\')}c`;
    const whole = new OscTokenizer().push(data);
    expect(whole).toHaveLength(2);
    for (let i = 1; i < data.length; i++) {
      const t = new OscTokenizer();
      expect([...t.push(data.slice(0, i)), ...t.push(data.slice(i))]).toEqual(whole);
    }
  });

  it('ignores non-OSC escapes and drops oversized payloads', () => {
    const t = new OscTokenizer();
    expect(t.push('\x1b[31mred\x1b[0m')).toEqual([]);
    expect(t.push('\x1b]6973;' + 'x'.repeat(70000) + '\x07')).toEqual([]);
    expect(t.push(osc('133;A;aid=x'))).toHaveLength(1);
  });

  it('recovers when an OSC is aborted by a new ESC', () => {
    const t = new OscTokenizer();
    expect(t.push('\x1b]133;A\x1b[0m' + osc('133;B;aid=x'))).toEqual([{ id: 133, payload: 'B;aid=x' }]);
  });
});

describe('parseOsc', () => {
  it('requires the nonce', () => {
    expect(parseOsc(133, 'A', N)).toBeNull();
    expect(parseOsc(133, 'A;aid=wrong', N)).toBeNull();
    expect(parseOsc(133, 'A;aid=' + N, N)).toEqual({ t: 'promptStart' });
    expect(parseOsc(6973, 'wrong;cwd;QQ==', N)).toBeNull();
    expect(parseOsc(133, 'A;aid=x', '')).toBeNull();
  });

  it('parses D with and without exit code', () => {
    expect(parseOsc(133, `D;130;aid=${N}`, N)).toEqual({ t: 'finished', exitCode: 130 });
    expect(parseOsc(133, `D;aid=${N}`, N)).toEqual({ t: 'finished' });
  });

  it('decodes Thai command text and path', () => {
    const text = 'echo "สวัสดี น้ำ ผู้ใหญ่"';
    expect(parseOsc(6973, `${N};cmd;7;${encodeB64(text)}`, N)).toEqual({
      t: 'commandLine',
      commandId: 7,
      text
    });
    expect(parseOsc(6973, `${N};cwd;${encodeB64('/home/ผู้ใช้')}`, N)).toEqual({
      t: 'cwd',
      path: '/home/ผู้ใช้'
    });
  });

  it('parses hello', () => {
    expect(parseOsc(6973, `${N};hello;bash;5.2.21;1`, N)).toEqual({
      t: 'hello',
      shell: 'bash',
      version: '5.2.21',
      blocks: true
    });
  });
});
