import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { migrateLegacyUserData } from './migrate-legacy';

vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'arctri-mig-'));
  return { appData: root, newDir: join(root, 'Arctri'), oldDir: join(root, 'AgentDock') };
};

describe('migrateLegacyUserData', () => {
  it('copies prefs and database from the old profile', () => {
    const { appData, newDir, oldDir } = setup();
    mkdirSync(oldDir);
    writeFileSync(join(oldDir, 'preferences.json'), '{"a":1}');
    writeFileSync(join(oldDir, 'agentdock.db'), 'db');
    migrateLegacyUserData(newDir, appData);
    expect(readFileSync(join(newDir, 'arctri.db'), 'utf8')).toBe('db');
    expect(existsSync(join(newDir, 'preferences.json'))).toBe(true);
    expect(existsSync(join(oldDir, 'agentdock.db'))).toBe(true);
  });

  it('does nothing when the new profile already exists', () => {
    const { appData, newDir, oldDir } = setup();
    mkdirSync(oldDir);
    mkdirSync(newDir);
    writeFileSync(join(oldDir, 'agentdock.db'), 'old');
    writeFileSync(join(newDir, 'arctri.db'), 'new');
    migrateLegacyUserData(newDir, appData);
    expect(readFileSync(join(newDir, 'arctri.db'), 'utf8')).toBe('new');
  });

  it('does nothing without an old profile', () => {
    const { appData, newDir } = setup();
    migrateLegacyUserData(newDir, appData);
    expect(existsSync(newDir)).toBe(false);
  });
});
