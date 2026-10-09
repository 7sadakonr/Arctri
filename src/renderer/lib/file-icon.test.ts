import { describe, expect, it } from 'vitest';
import { iconName } from './file-icon';

describe('iconName', () => {
  it('prefers the file name over the extension', () => {
    expect(iconName('package.json', false)).not.toBe(iconName('other.json', false));
  });
  it('uses the longest matching extension', () => {
    expect(iconName('a.test.ts', false)).not.toBe(iconName('a.ts', false));
  });
  it('is case-insensitive and falls back to the plain file icon', () => {
    expect(iconName('README.MD', false)).toBe(iconName('readme.md', false));
    expect(iconName('zzz.unknownext', false)).toBe('file');
  });
  it('picks open and closed folder icons, and ignores inherited object keys', () => {
    expect(iconName('src', true, true)).not.toBe(iconName('src', true, false));
    expect(iconName('constructor', true)).toBe('folder');
    expect(iconName('toString', false)).toBe('file');
  });
});
