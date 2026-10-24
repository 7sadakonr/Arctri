import { describe, expect, it } from 'vitest';
import { filterRanked } from './filter';
import { matchKey, toAccelerator } from './keys';

const ev = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });

describe('matchKey', () => {
  const newTab = { mac: { key: 't', mod: true }, other: { key: 't', mod: true, shift: true } };
  it('uses the platform modifier', () => {
    expect(matchKey(ev('T', { ctrlKey: true, shiftKey: true }), newTab, false)).toBe(true);
    expect(matchKey(ev('t', { ctrlKey: true }), newTab, false)).toBe(false); // plain Ctrl+T belongs to the shell
    expect(matchKey(ev('t', { metaKey: true }), newTab, true)).toBe(true);
  });
  it('palette chord needs exactly its modifiers', () => {
    const p = { key: 'p', mod: true, shift: true };
    expect(matchKey(ev('P', { ctrlKey: true, shiftKey: true }), p, false)).toBe(true);
    expect(matchKey(ev('p', { ctrlKey: true, shiftKey: true, altKey: true }), p, false)).toBe(false);
    expect(matchKey(ev('p', { ctrlKey: true }), p, false)).toBe(false);
  });
  it('real Control stays Control on a Mac and anyShift ignores shift', () => {
    expect(matchKey(ev('Tab', { ctrlKey: true }), { key: 'tab', ctrl: true, anyShift: true }, true)).toBe(true);
    expect(matchKey(ev('+', { ctrlKey: true, shiftKey: true }), { key: '+', mod: true, anyShift: true }, false)).toBe(true);
  });
});

describe('filterRanked', () => {
  const list = [
    { item: 'New Terminal', fields: ['New Terminal', 'create tab'] },
    { item: 'Close Tab', fields: ['Close Tab', 'remove'] },
    { item: 'Settings', fields: ['Settings', 'preferences options'] }
  ];
  it('keeps the order for an empty query', () => expect(filterRanked(list, '')).toEqual(['New Terminal', 'Close Tab', 'Settings']));
  it('matches titles first, then keywords, and all words must match', () => {
    expect(filterRanked(list, 'tab')[0]).toBe('Close Tab');
    expect(filterRanked(list, 'prefer')).toEqual(['Settings']);
    expect(filterRanked(list, 'new zzz')).toEqual([]);
  });
});

describe('toAccelerator', () => {
  it('writes the Mac chord of a command', () => {
    expect(toAccelerator({ mac: { key: 't', mod: true }, other: { key: 't', mod: true, shift: true } })).toBe('Cmd+T');
    expect(toAccelerator({ key: 'e', mod: true, shift: true })).toBe('Cmd+Shift+E');
    expect(toAccelerator({ key: 'tab', ctrl: true, shift: true })).toBe('Ctrl+Shift+Tab');
    expect(toAccelerator([{ key: '=', mod: true, anyShift: true }])).toBe('Cmd+Plus');
    expect(toAccelerator(undefined)).toBeUndefined();
  });
});
