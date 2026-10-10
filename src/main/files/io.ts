export const MAX_EDIT_BYTES = 5 * 1024 * 1024;

export type Eol = 'lf' | 'crlf';

export type DecodeResult = { text: string; eol: Eol; bom: boolean } | 'binary';

/**
 * Turns file bytes into editor text. The editor always sees "\n"; the original line ending and BOM are
 * remembered so a save writes the file back the way it was.
 */
export function decodeFile(buf: Buffer): DecodeResult {
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) return 'binary';
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const raw = buf.subarray(bom ? 3 : 0).toString('utf8');
  if (raw.includes('�') && /[\u0000-\u0008\u000e-\u001f]/.test(raw.slice(0, 8192))) return 'binary';
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/\n/g) ?? []).length - crlf;
  const eol: Eol = crlf > lf ? 'crlf' : 'lf';
  return { text: raw.replace(/\r\n/g, '\n'), eol, bom };
}

export function encodeFile(text: string, eol: Eol, bom: boolean): Buffer {
  const body = Buffer.from(eol === 'crlf' ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'), 'utf8');
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

export type FileReadError = 'too-large' | 'binary' | 'not-found' | 'denied' | 'failed';

export type FileReadResult =
  | { ok: true; text: string; eol: Eol; bom: boolean; mtimeMs: number; size: number }
  | { ok: false; error: FileReadError };

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ImageReadResult =
  | { ok: true; base64: string; mtimeMs: number; size: number }
  | { ok: false; error: FileReadError };

export type FileWriteResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; error: 'conflict' | 'denied' | 'failed'; mtimeMs?: number };
