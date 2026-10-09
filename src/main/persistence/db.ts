import Database from 'better-sqlite3';
import { existsSync, renameSync } from 'node:fs';

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

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Opens (and migrates) the database. A corrupt file is moved aside and recreated. */
export function openDb(file: string): { db: Db; recovered: boolean } {
  const attempt = (): Db => {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (file !== ':memory:') db.pragma('quick_check');
    migrate(db);
    return db;
  };
  try {
    return { db: attempt(), recovered: false };
  } catch {
    if (file !== ':memory:' && existsSync(file)) renameSync(file, `${file}.corrupt-${Date.now()}`);
    return { db: attempt(), recovered: true };
  }
}
