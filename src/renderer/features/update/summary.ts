import type { UpdateStatus } from '@shared/types/update';
import type { MessageKey } from '@shared/i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** One line for the current update phase, shared by the dialog, Settings and About. */
export function updateSummary(t: T, s: UpdateStatus | undefined): string {
  const p = s?.phase;
  if (!p || p.kind === 'idle') return '';
  switch (p.kind) {
    case 'checking': return t('update.checking');
    case 'up-to-date': return t('update.upToDate');
    case 'available': return t('update.available', { version: p.version });
    case 'downloading': return t('update.downloading', { version: p.version, percent: p.percent });
    case 'downloaded': return t('update.downloaded', { version: p.version });
    case 'error': return t(`update.error.${p.code}` as MessageKey, { message: p.message });
  }
}
