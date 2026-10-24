import { posix, win32 } from 'node:path';
import type { EnvironmentRef } from '@shared/types/env';
import type { EnvironmentQuery } from '../env-query/service';
import type { FsOpResult } from './io';

export interface TransferResult {
  from: string;
  /** Where it ended up, as an absolute path. */
  to?: string;
  error?: 'exists' | 'not-found' | 'denied' | 'failed';
}

const lib = (env: EnvironmentRef) => (env.kind === 'windows' ? win32 : posix);

/** `a.txt` -> `a copy.txt`, `a copy 2.txt`, ...; a folder or a name that starts with a dot has no extension. */
export function copyName(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`;
}

/** Moves each path into `toDir`. A name already taken there is reported, never replaced. */
export async function moveMany(
  q: EnvironmentQuery, env: EnvironmentRef, root: string, from: string[], toDir: string
): Promise<TransferResult[]> {
  const p = lib(env);
  const out: TransferResult[] = [];
  for (const f of from) {
    const to = p.join(toDir, p.basename(f));
    if (p.dirname(f) === toDir || f === to) continue; // already there
    const r: FsOpResult = await q.renameEntry(env, root, f, to);
    out.push(r.ok ? { from: f, to } : { from: f, error: r.error });
  }
  return out;
}

/** Copies each path into `toDir`; a name already taken gets "copy" added, as file managers do. */
export async function copyMany(
  q: EnvironmentQuery, env: EnvironmentRef, root: string, from: string[], toDir: string
): Promise<TransferResult[]> {
  const p = lib(env);
  const out: TransferResult[] = [];
  for (const f of from) {
    const name = p.basename(f);
    let result: TransferResult = { from: f, error: 'failed' };
    for (let n = 0; n < 100; n++) {
      const to = p.join(toDir, n === 0 ? name : copyName(name, n));
      const r = await q.copyEntry(env, root, f, to);
      if (r.ok) {
        result = { from: f, to };
        break;
      }
      if (r.error !== 'exists') {
        result = { from: f, error: r.error };
        break;
      }
    }
    out.push(result);
  }
  return out;
}
