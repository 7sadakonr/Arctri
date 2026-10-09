import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger';

const LEGACY_DIR = 'AgentDock';

/** Carries preferences and history over from the pre-rename "AgentDock" profile, once. The old folder is left untouched. */
export function migrateLegacyUserData(newDir: string, appDataDir: string): void {
  try {
    const oldDir = join(appDataDir, LEGACY_DIR);
    if (!existsSync(oldDir) || existsSync(join(newDir, 'arctri.db')) || existsSync(join(newDir, 'preferences.json'))) return;
    mkdirSync(newDir, { recursive: true });
    const copies: Array<[string, string]> = [
      ['preferences.json', 'preferences.json'],
      ['agentdock.db', 'arctri.db'],
      ['agentdock.db-wal', 'arctri.db-wal'],
      ['agentdock.db-shm', 'arctri.db-shm']
    ];
    for (const [from, to] of copies) {
      if (existsSync(join(oldDir, from))) copyFileSync(join(oldDir, from), join(newDir, to));
    }
    logger.info('migrated profile from AgentDock');
  } catch (err) {
    logger.warn(`legacy profile migration failed: ${String(err)}`);
  }
}
