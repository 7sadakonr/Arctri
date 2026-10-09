import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

let override: string | undefined;

/** Called once at startup in the packaged app (process.resourcesPath). */
export function setResourcesDir(dir: string): void {
  override = dir;
}

/** Directory that contains `shell-integration/`. Works from source, vitest and the bundle. */
export function resourcesDir(): string {
  if (override) return override;
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'resources');
    if (existsSync(join(candidate, 'shell-integration'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('shell-integration resources not found');
}

export const integrationDir = (): string => join(resourcesDir(), 'shell-integration');
