import type { WslDistro } from '@shared/types/wsl';

/** `wsl.exe -l -v` is UTF-16LE on older builds and UTF-8 when WSL_UTF8=1. */
export function decodeWslOutput(buf: Buffer): string {
  let text: string;
  if (buf.length >= 2 && (buf[0] === 0xff && buf[1] === 0xfe)) {
    text = buf.subarray(2).toString('utf16le');
  } else if (buf.includes(0)) {
    text = buf.toString('utf16le');
  } else {
    text = buf.toString('utf8');
  }
  return text.replace(/^\uFEFF/, '').replace(/\0/g, '');
}

const STATES: Record<string, WslDistro['state']> = {
  Running: 'Running',
  Stopped: 'Stopped',
  Installing: 'Installing',
  Converting: 'Converting',
  Uninstalling: 'Uninstalling'
};

export function parseWslList(text: string): WslDistro[] {
  const out: WslDistro[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines.slice(1)) {
    const m = /^\s*(\*)?\s*(.+?)\s+(\S+)\s+([12])\s*$/.exec(line);
    if (!m) continue;
    const name = m[2]!;
    out.push({
      name,
      state: STATES[m[3]!] ?? 'Unknown',
      version: m[4] === '1' ? 1 : 2,
      isDefault: m[1] === '*',
      hidden: /^docker-desktop/i.test(name)
    });
  }
  return out;
}
