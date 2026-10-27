import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from './db';
import { HistoryRepo } from './history-repo';
import { MemoryBackend, PrefsStore } from './prefs';
import { prefsPatchSchema } from '@shared/prefs';

describe('HistoryRepo', () => {
  const make = () => new HistoryRepo(openDb(':memory:').db, 5);

  it('records, searches by prefix and keeps environments apart', () => {
    const h = make();
    h.record({ envKey: 'windows:pwsh', command: 'git status', at: 1 });
    h.record({ envKey: 'windows:pwsh', command: 'git status', at: 3 });
    h.record({ envKey: 'windows:pwsh', command: 'git commit -m "แก้บั๊ก"', at: 2 });
    h.record({ envKey: 'wsl:Ubuntu:bash', command: 'git log', at: 4 });
    const r = h.search('windows:pwsh', 'git ', 10);
    expect(r.map((x) => x.command)).toEqual(['git status', 'git commit -m "แก้บั๊ก"']);
    expect(r[0]!.count).toBe(2);
    expect(h.search('windows:pwsh', 'git commit -m "แก้', 10)).toHaveLength(1);
  });

  it('ignores blank and space-prefixed commands and prunes to the limit', () => {
    const h = make();
    h.record({ envKey: 'k', command: ' secret', at: 1 });
    h.record({ envKey: 'k', command: '   ', at: 1 });
    for (let i = 0; i < 9; i++) h.record({ envKey: 'k', command: `cmd${i}`, at: i + 10 });
    expect(h.search('k', 'secret', 10)).toHaveLength(0);
    expect(h.recent('k', 100)).toEqual(['cmd8', 'cmd7', 'cmd6', 'cmd5', 'cmd4']);
  });
});

describe('PrefsStore', () => {
  it('applies defaults, validates and recovers from bad values', () => {
    const b = new MemoryBackend();
    b.set({ fontSize: 'big', language: 'th', scrollback: 50000 });
    const p = new PrefsStore(b);
    expect(p.get().language).toBe('th');
    expect(p.get().scrollback).toBe(50000);
    expect(p.get().fontSize).toBe(14);
    expect(() => p.set({ fontSize: 3 })).toThrow();
    expect(p.set({ theme: 'light' }).theme).toBe('light');
  });
});

describe('prefs patches', () => {
  it('only contain the keys that were sent, so saving one setting never resets another', () => {
    expect(prefsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' });
    expect(prefsPatchSchema.parse({})).toEqual({});
    expect(() => prefsPatchSchema.parse({ fontSize: 2 })).toThrow();
    const p = new PrefsStore(new MemoryBackend());
    p.set(prefsPatchSchema.parse({ language: 'th' }));
    p.set(prefsPatchSchema.parse({ theme: 'light' }));
    expect(p.get().language).toBe('th');
    expect(p.get().theme).toBe('light');
  });
});

describe('layout prefs', () => {
  it('defaults the UI scale and file panel width', () => {
    const p = new PrefsStore(new MemoryBackend()).get();
    expect(p.uiScale).toBe(1.1);
    expect(p.filePanelWidth).toBe(280);
    expect(p.viewerWidth).toBe(560);
  });

  it('rejects out-of-range values', () => {
    expect(prefsPatchSchema.safeParse({ uiScale: 3 }).success).toBe(false);
    expect(prefsPatchSchema.safeParse({ filePanelWidth: 100 }).success).toBe(false);
    expect(prefsPatchSchema.safeParse({ filePanelWidth: 400 }).success).toBe(true);
  });
});

describe('openDb backup before a migration', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'arctri-db-'));
    dirs.push(d);
    return d;
  };
  const v1 = ['CREATE TABLE t (x TEXT);'];
  const v2 = [...v1, 'ALTER TABLE t ADD COLUMN y TEXT;'];
  const v3 = [...v2, 'ALTER TABLE t ADD COLUMN z TEXT;'];
  const v4 = [...v3, 'ALTER TABLE t ADD COLUMN w TEXT;'];

  it('keeps a copy of the old data when a newer version migrates, and none for a fresh database', () => {
    const file = join(tmp(), 'arctri.db');
    const first = openDb(file, v1).db;
    first.prepare('INSERT INTO t (x) VALUES (?)').run('before');
    first.close();
    expect(readdirSync(join(file, '..')).filter((n) => n.includes('.bak-'))).toEqual([]);

    openDb(file, v2).db.close();
    const backup = join(file, '..', 'arctri.db.bak-v1');
    expect(existsSync(backup)).toBe(true);
    const b = new Database(backup, { readonly: true });
    expect(b.prepare('SELECT x FROM t').all()).toEqual([{ x: 'before' }]);
    expect(b.pragma('user_version', { simple: true })).toBe(1);
    b.close();
  });

  it('keeps only the two newest backups', () => {
    const file = join(tmp(), 'arctri.db');
    openDb(file, v1).db.close();
    for (const m of [v2, v3, v4]) openDb(file, m).db.close();
    expect(readdirSync(join(file, '..')).filter((n) => n.includes('.bak-')).sort()).toEqual(['arctri.db.bak-v2', 'arctri.db.bak-v3']);
  });
});
