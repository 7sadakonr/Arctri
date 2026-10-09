import { describe, expect, it } from 'vitest';
import { decodeFile, encodeFile } from './io';

describe('file decoding and encoding', () => {
  it('keeps CRLF files CRLF and LF files LF through a round trip', () => {
    const crlf = Buffer.from('a\r\nb\r\nc\r\n');
    const d = decodeFile(crlf);
    expect(d).toMatchObject({ text: 'a\nb\nc\n', eol: 'crlf', bom: false });
    expect(encodeFile((d as { text: string }).text, 'crlf', false).equals(crlf)).toBe(true);
    const lf = Buffer.from('a\nb\n');
    expect(encodeFile((decodeFile(lf) as { text: string }).text, 'lf', false).equals(lf)).toBe(true);
  });

  it('picks the dominant line ending of a mixed file', () => {
    expect(decodeFile(Buffer.from('a\r\nb\r\nc\nd\r\n'))).toMatchObject({ eol: 'crlf' });
    expect(decodeFile(Buffer.from('a\nb\nc\r\nd\n'))).toMatchObject({ eol: 'lf' });
    expect(decodeFile(Buffer.from('no newline'))).toMatchObject({ eol: 'lf' });
  });

  it('remembers and restores a UTF-8 BOM and handles Thai text', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('สวัสดี น้ำ ผู้ใหญ่\n', 'utf8')]);
    const d = decodeFile(buf);
    expect(d).toMatchObject({ text: 'สวัสดี น้ำ ผู้ใหญ่\n', bom: true });
    expect(encodeFile((d as { text: string }).text, 'lf', true).equals(buf)).toBe(true);
  });

  it('refuses binary content', () => {
    expect(decodeFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))).toBe('binary');
    expect(decodeFile(Buffer.from('plain text'))).not.toBe('binary');
  });

  it('normalises line endings typed in the editor when saving as CRLF', () => {
    expect(encodeFile('x\ny\r\nz', 'crlf', false).toString()).toBe('x\r\ny\r\nz');
  });
});
