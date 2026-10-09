import type { EnvPath } from '@shared/types/env';
import type { SessionInfo } from '@shared/types/session';
import type { Db } from './db';

export interface SavedSession {
  id: string;
  position: number;
  title: string;
  titleSource: 'user' | 'auto';
  profileId: string;
  kind: 'shell' | 'agent';
  agentId?: string;
  cwd?: EnvPath;
}

/** Only metadata is stored; processes never survive an application restart. */
export class SessionRepo {
  constructor(private readonly db: Db) {}

  saveAll(sessions: SessionInfo[]): void {
    const ins = this.db.prepare(
      `INSERT INTO sessions (id, position, title, title_source, profile_id, kind, agent_id, cwd_env, cwd_distro, cwd_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.db.transaction(() => {
      this.db.exec('DELETE FROM sessions');
      sessions.forEach((s, i) => {
        ins.run(
          s.id, i, s.title, s.titleSource, s.profileId, s.kind, s.agentId ?? null,
          s.cwd?.env ?? null, s.cwd?.env === 'wsl' ? s.cwd.distro : null, s.cwd?.path ?? null, Date.now()
        );
      });
    })();
  }

  load(): SavedSession[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY position').all() as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const cwd: EnvPath | undefined =
        r['cwd_env'] === 'windows'
          ? { env: 'windows', path: r['cwd_path'] as never }
          : r['cwd_env'] === 'wsl'
            ? { env: 'wsl', distro: r['cwd_distro'] as string, path: r['cwd_path'] as never }
            : undefined;
      return {
        id: r['id'] as string, position: r['position'] as number, title: r['title'] as string,
        titleSource: r['title_source'] as 'user' | 'auto', profileId: r['profile_id'] as string,
        kind: r['kind'] as 'shell' | 'agent', ...(r['agent_id'] ? { agentId: r['agent_id'] as string } : {}),
        ...(cwd ? { cwd } : {})
      };
    });
  }
}
