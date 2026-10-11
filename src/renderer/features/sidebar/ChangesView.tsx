import type { SessionInfo } from '@shared/types/session';
import { cn } from '@/lib/cn';
import { iconUrl } from '@/lib/file-icon';
import { useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useChanges } from '../agents/useChanges';

const statusColor = (s: string) => (s === '??' ? 'text-ok' : s.includes('D') ? 'text-danger' : 'text-warn');
export const baseName = (p: string) => p.replace(/\\/g, '/').split('/').at(-1) ?? p;
export const dirName = (p: string) => {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
};

/** The files that differ from HEAD. Clicking one shows what changed in it, beside the terminal. */
export function ChangesView({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const data = useChanges(info.id, active);

  if (!data) return <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.notGit')}</div>;
  if (data.files.length === 0) return <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.noChanges')}</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-fg-muted">
        {t('sidebar.changesSummary', { n: data.files.length })}{' '}
        <span className="text-ok">+{data.added}</span> <span className="text-danger">−{data.deleted}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {data.files.map((f) => (
          <button
            key={f.path}
            type="button"
            data-path={f.path}
            title={f.path}
            onClick={() => useSessions.getState().openViewer(info.id, f.path, f.status.includes('D') ? 'file' : 'diff')}
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            <img src={iconUrl(baseName(f.path), false)} alt="" width={16} height={16} draggable={false} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-fg">{baseName(f.path)}</span>
              {dirName(f.path) && <span className="ml-1.5 text-[11px] opacity-70">{dirName(f.path)}</span>}
            </span>
            {(f.added > 0 || f.deleted > 0) && (
              <span className="shrink-0 text-[10px]">
                <span className="text-ok">+{f.added}</span> <span className="text-danger">−{f.deleted}</span>
              </span>
            )}
            <span className={cn('w-5 shrink-0 text-center font-mono text-[11px]', statusColor(f.status))}>{f.status.trim() || 'M'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
