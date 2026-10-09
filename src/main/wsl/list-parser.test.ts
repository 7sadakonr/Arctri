import { describe, expect, it } from 'vitest';
import { decodeWslOutput, parseWslList } from './list-parser';

const table = `  NAME              STATE           VERSION
* Ubuntu            Running         2
  Debian            Stopped         2
  docker-desktop    Stopped         2
  Legacy            Stopped         1
  My Distro         Running         2
`;

describe('wsl --list --verbose parsing', () => {
  it('reads names, state, version, default and hides internal distributions', () => {
    const d = parseWslList(table);
    expect(d.map((x) => x.name)).toEqual(['Ubuntu', 'Debian', 'docker-desktop', 'Legacy', 'My Distro']);
    expect(d[0]).toMatchObject({ isDefault: true, state: 'Running', version: 2, hidden: false });
    expect(d[1]).toMatchObject({ isDefault: false, state: 'Stopped' });
    expect(d[2]!.hidden).toBe(true);
    expect(d[3]!.version).toBe(1);
    expect(d[4]).toMatchObject({ name: 'My Distro', state: 'Running' });
  });

  it('survives localised or unknown states and empty output', () => {
    expect(parseWslList('  NAME STATE VERSION\n* Ubuntu กำลังทำงาน 2\n')[0]).toMatchObject({ name: 'Ubuntu', state: 'Unknown' });
    expect(parseWslList('')).toEqual([]);
    expect(parseWslList('Windows Subsystem for Linux has no installed distributions.')).toEqual([]);
  });

  it('decodes UTF-16LE (with and without BOM) and UTF-8 output', () => {
    const utf16 = Buffer.from('\ufeff' + table, 'utf16le');
    expect(decodeWslOutput(utf16)).toBe(table);
    expect(decodeWslOutput(Buffer.from(table, 'utf16le'))).toBe(table);
    expect(decodeWslOutput(Buffer.from(table, 'utf8'))).toBe(table);
    expect(parseWslList(decodeWslOutput(Buffer.from('  NAME STATE VERSION\n* อูบุนตู Running 2\n', 'utf16le')))[0]!.name).toBe('อูบุนตู');
  });
});
