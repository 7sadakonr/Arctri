import type { GitSyncResult } from '@shared/git/sync';
import { tNow } from './i18n';

/** The words for a refused update, from the code the main process gave. */
export function syncErrorText(r: Extract<GitSyncResult, { ok: false }>): string {
  const key = `sync.err.${r.code}` as const;
  return tNow(key, { reason: r.error });
}
