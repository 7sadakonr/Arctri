import Database from 'better-sqlite3';
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { logger } from '../logger';

export type Db = Database.Database;

const MIGRATIONS: string[] = [
  `CREATE TABLE history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     env_key TEXT NOT NULL,
     command TEXT NOT NULL,
     cwd TEXT,
     exit_code INTEGER,
     at INTEGER NOT NULL
   );
   CREATE INDEX history_env_at ON history (env_key, at DESC);
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     position INTEGER NOT NULL,
     title TEXT NOT NULL,
     title_source TEXT NOT NULL,
     profile_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     agent_id TEXT,
     cwd_env TEXT,
     cwd_distro TEXT,
     cwd_path TEXT,
     updated_at INTEGER NOT NULL
   );`
];

const KEEP_BACKUPS = 2;

/**
 * Before an existing database is changed by a newer version, a consistent copy is kept next to it (`<file>.bak-v<old>`),
 * so a failed or regretted update can be undone by hand. Failing to copy never stops the app from starting.
 */
function backupBeforeMigrating(db: Db, file: string, from: number): void {
  try {
    const target = `${file}.bak-v${from}`;
    rmSync(target, { force: true });
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const prefix = `${basename(file)}.bak-v`;
    const old = readdirSync(dirname(file)).filter((n) => n.startsWith(prefix)).map((n) => ({ n, v: Number(n.slice(prefix.length)) }));
    for (const b of old.sort((a, c) => c.v - a.v).slice(KEEP_BACKUPS)) rmSync(join(dirname(file), b.n), { force: true });
  } catch (err) {
    logger.warn('database backup before migration failed', err);
  }
}

function migrate(db: Db, file: string, migrations: string[]): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > 0 && current < migrations.length && file !== ':memory:') backupBeforeMigrating(db, file, current);
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Opens (and migrates) the database. A corrupt file is moved aside and recreated. */
export function openDb(file: string, migrations: string[] = MIGRATIONS): { db: Db; recovered: boolean } {
  const attempt = (): Db => {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (file !== ':memory:') db.pragma('quick_check');
    migrate(db, file, migrations);
    return db;
  };
  try {
    return { db: attempt(), recovered: false };
  } catch {
    if (file !== ':memory:' && existsSync(file)) renameSync(file, `${file}.corrupt-${Date.now()}`);
    return { db: attempt(), recovered: true };
  }
}
