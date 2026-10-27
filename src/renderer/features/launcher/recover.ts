import type { MessageKey } from '@shared/i18n';

/** What a person can do about a failure to start something, by what the reason says. Undefined when nothing specific is known. */
export function recoverHint(reason: string): MessageKey | undefined {
  if (/is not installed in/i.test(reason)) return 'recover.missingCli';
  if (/\bwsl\b|distribution/i.test(reason)) return 'recover.wsl';
  if (/EACCES|EPERM|access is denied|permission denied|operation not permitted/i.test(reason)) return 'recover.permission';
  if (/ENOENT|not recognized|cannot find|no such file|not found/i.test(reason)) return 'recover.notFound';
  return undefined;
}
