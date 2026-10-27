import { describe, expect, it } from 'vitest';
import { makeRedactor } from './redact';

describe('redact', () => {
  const r = makeRedactor('C:\\Users\\somchai', 'somchai');

  it('hides the home folder and the account name in either path spelling', () => {
    expect(r('open C:\\Users\\somchai\\proj\\a.txt')).toBe('open ~\\proj\\a.txt');
    expect(r('open C:/Users/somchai/proj')).toBe('open ~/proj');
    expect(r('\\\\wsl.localhost\\Ubuntu\\home\\somchai\\x')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\<user>\\x');
  });

  it('also hides paths inside JSON log lines, where backslashes are doubled', () => {
    expect(r(JSON.stringify({ msg: 'C:\\Users\\somchai\\x' }))).toBe('{"msg":"~\\\\x"}');
  });

  it('hides tokens, keys and credentials in URLs', () => {
    expect(r('push failed ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe('push failed [token]');
    expect(r('Authorization: Bearer abcdef0123456789abcdef')).not.toContain('abcdef0123456789');
    expect(r('https://me:hunter2@github.com/x/y.git')).toBe('https://[redacted]@github.com/x/y.git');
    expect(r('{"password":"hunter2hunter2"}')).not.toContain('hunter2');
    expect(r('key sk-ant-api03-abcdefghijklmnop')).toBe('key [key]');
  });

  it('leaves ordinary text alone, Thai included', () => {
    expect(r('การเชื่อมต่อล้มเหลว (ENOTFOUND github.com)')).toBe('การเชื่อมต่อล้มเหลว (ENOTFOUND github.com)');
  });
});
