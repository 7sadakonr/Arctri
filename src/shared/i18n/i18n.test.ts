import { describe, expect, it } from 'vitest';
import { en } from './en';
import { th } from './th';
import { formatDuration, resolveLang, translate } from './index';

describe('i18n', () => {
  it('has a Thai translation for every English key, with the same placeholders', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(th[key], key).toBeTruthy();
      expect(placeholders(th[key]), key).toBe(placeholders(en[key]));
    }
  });

  it('resolves language and fills parameters', () => {
    expect(resolveLang('auto', 'th-TH')).toBe('th');
    expect(resolveLang('auto', 'en-US')).toBe('en');
    expect(resolveLang('en', 'th-TH')).toBe('en');
    expect(translate('th', 'session.exited', { code: 3 })).toContain('3');
  });

  it('formats durations', () => {
    expect(formatDuration(240)).toBe('240 ms');
    expect(formatDuration(3200)).toBe('3.2 s');
    expect(formatDuration(75_000)).toBe('1m 15s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });
});
