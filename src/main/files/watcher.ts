import { watch, type FSWatcher } from 'node:fs';
import type { EnvironmentRef } from '@shared/types/env';
import { resolveWithin } from './refs';

const MAX_DIRS = 200;
const DEBOUNCE_MS = 150;

interface Watched {
  dirs: Map<string, FSWatcher>;
  pending: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Tells the file panel which folders changed. Only the folders the panel shows open are watched, one level each,
 * so a closed `node_modules` costs nothing. A burst of events becomes one message per folder.
 */
export class FileWatcher {
  private readonly sessions = new Map<string, Watched>();

  constructor(private readonly emit: (sessionId: string, dirs: string[]) => void) {}

  /**
   * Makes `dirs` (relative to `root`) the folders being watched. Answers false where watching is not used
   * (a WSL folder is read through the network share, which does not report changes reliably: the panel polls there).
   */
  setDirs(sessionId: string, env: EnvironmentRef, root: string, dirs: string[]): boolean {
    if (env.kind === 'wsl') {
      this.clear(sessionId);
      return false;
    }
    const w = this.sessions.get(sessionId) ?? { dirs: new Map(), pending: new Set() };
    this.sessions.set(sessionId, w);
    const want = new Set(dirs.slice(0, MAX_DIRS));
    for (const [rel, watcher] of w.dirs) {
      if (want.has(rel)) continue;
      watcher.close();
      w.dirs.delete(rel);
    }
    for (const rel of want) {
      if (w.dirs.has(rel)) continue;
      const abs = resolveWithin(root, rel, env.kind);
      if (!abs) continue;
      try {
        const watcher = watch(abs, { persistent: false }, () => this.queue(sessionId, w, rel));
        // a folder that is gone (or cannot be watched) stops reporting; the folder above reports its disappearance
        watcher.on('error', () => {
          watcher.close();
          if (w.dirs.get(rel) === watcher) w.dirs.delete(rel);
          this.queue(sessionId, w, rel);
        });
        w.dirs.set(rel, watcher);
      } catch {
        /* not watchable: the panel's other refreshes still apply */
      }
    }
    return true;
  }

  private queue(sessionId: string, w: Watched, rel: string): void {
    w.pending.add(rel);
    if (w.timer) return;
    w.timer = setTimeout(() => {
      w.timer = undefined;
      const dirs = [...w.pending];
      w.pending.clear();
      if (this.sessions.get(sessionId) === w && dirs.length) this.emit(sessionId, dirs);
    }, DEBOUNCE_MS);
  }

  clear(sessionId: string): void {
    const w = this.sessions.get(sessionId);
    if (!w) return;
    for (const watcher of w.dirs.values()) watcher.close();
    if (w.timer) clearTimeout(w.timer);
    this.sessions.delete(sessionId);
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.clear(id);
  }
}
