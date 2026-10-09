import type { Db } from './db';

export interface HistoryEntry {
  command: string;
  lastAt: number;
  count: number;
  lastCwd?: string;
  /** Used in this working directory at least once. */
  inCwd: boolean;
}

export class HistoryRepo {
  constructor(private readonly db: Db, private limit = 10000) {}

  setLimit(n: number): void {
    this.limit = n;
  }

  /** Commands that start with a space are not recorded (HISTCONTROL=ignorespace convention). */
  record(e: { envKey: string; command: string; cwd?: string; exitCode?: number; at: number }): void {
    const command = e.command.replace(/\s+$/, '');
    if (!command.trim() || /^\s/.test(e.command)) return;
    this.db
      .prepare('INSERT INTO history (env_key, command, cwd, exit_code, at) VALUES (?, ?, ?, ?, ?)')
      .run(e.envKey, command, e.cwd ?? null, e.exitCode ?? null, e.at);
    this.prune(e.envKey);
  }

  private prune(envKey: string): void {
    this.db
      .prepare(
        `DELETE FROM history WHERE env_key = ? AND id NOT IN
           (SELECT id FROM history WHERE env_key = ? ORDER BY at DESC, id DESC LIMIT ?)`
      )
      .run(envKey, envKey, this.limit);
  }

  /** Distinct commands with the given prefix (case-sensitive), newest first. */
  search(envKey: string, prefix: string, limit: number, cwd?: string): HistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT command, MAX(at) AS lastAt, COUNT(*) AS count,
                MAX(CASE WHEN cwd IS ? THEN 1 ELSE 0 END) AS inCwd,
                (SELECT cwd FROM history h2 WHERE h2.env_key = h.env_key AND h2.command = h.command
                 ORDER BY at DESC LIMIT 1) AS lastCwd
           FROM history h
          WHERE env_key = ? AND substr(command, 1, ?) = ?
          GROUP BY command
          ORDER BY lastAt DESC
          LIMIT ?`
      )
      .all(cwd ?? null, envKey, [...prefix].length > 0 ? prefix.length : 0, prefix, limit) as Array<{
      command: string; lastAt: number; count: number; inCwd: number; lastCwd: string | null;
    }>;
    return rows.map((r) => ({
      command: r.command, lastAt: r.lastAt, count: r.count, inCwd: !!r.inCwd,
      ...(r.lastCwd ? { lastCwd: r.lastCwd } : {})
    }));
  }

  /** Previous commands in order, for Up/Down navigation. */
  recent(envKey: string, limit: number): string[] {
    const rows = this.db
      .prepare('SELECT command FROM history WHERE env_key = ? GROUP BY command ORDER BY MAX(at) DESC LIMIT ?')
      .all(envKey, limit) as Array<{ command: string }>;
    return rows.map((r) => r.command);
  }

  clear(): void {
    this.db.exec('DELETE FROM history');
  }
}
