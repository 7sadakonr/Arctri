import { describe, expect, it } from 'vitest';
import { formatRef, resolveWithin, uncToPosix } from './refs';

describe('file references for agents', () => {
  it('uses relative paths inside the folder and absolute ones outside', () => {
    expect(formatRef('/home/me/proj', '/home/me/proj/src/app.ts', 'wsl')).toBe('@src/app.ts');
    expect(formatRef('/home/me/proj', '/etc/hosts', 'wsl')).toBe('@/etc/hosts');
    expect(formatRef('C:\\proj', 'C:\\proj\\src\\app.ts', 'windows')).toBe('@src\\app.ts');
    expect(formatRef('C:\\proj', 'D:\\other\\f.txt', 'windows')).toBe('@D:\\other\\f.txt');
  });

  it('quotes names with spaces and keeps Thai text', () => {
    expect(formatRef('/p', '/p/my docs/a b.txt', 'wsl')).toBe('@"my docs/a b.txt"');
    expect(formatRef('/p', '/p/เอกสาร/ไฟล์.md', 'wsl')).toBe('@เอกสาร/ไฟล์.md');
  });

  it('never leaves the root', () => {
    expect(resolveWithin('/p/q', 'sub/a', 'wsl')).toBe('/p/q/sub/a');
    expect(resolveWithin('/p/q', '../x', 'wsl')).toBeUndefined();
    expect(resolveWithin('/p/q', '/etc', 'wsl')).toBeUndefined();
    expect(resolveWithin('C:\\p', 'a\\b', 'windows')).toBe('C:\\p\\a\\b');
    expect(resolveWithin('C:\\p', '..\\q', 'windows')).toBeUndefined();
    expect(resolveWithin('C:\\p', 'D:\\x', 'windows')).toBeUndefined();
  });

  it('converts WSL UNC paths for the matching distribution only', () => {
    expect(uncToPosix('\\\\wsl.localhost\\Ubuntu\\home\\me\\a.ts', 'Ubuntu')).toBe('/home/me/a.ts');
    expect(uncToPosix('\\\\wsl$\\ubuntu\\tmp', 'Ubuntu')).toBe('/tmp');
    expect(uncToPosix('\\\\wsl.localhost\\Debian\\x', 'Ubuntu')).toBeUndefined();
    expect(uncToPosix('C:\\x', 'Ubuntu')).toBeUndefined();
  });
});
