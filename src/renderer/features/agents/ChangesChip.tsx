import { FileText } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { Chip } from './Chip';
import { useSessions } from '@/stores/sessions';
import type { ChangesData } from './useChanges';

const statusColor = (s: string) => (s === '??' ? 'text-ok' : s.includes('D') ? 'text-danger' : 'text-warn');

/** "N • +A -D": the files that differ from HEAD. Picking one shows what changed in it. */
export function ChangesChip({ sessionId, data }: { sessionId: string; data: ChangesData | null }) {
  const t = useT();
  if (!data) return null; // not a git repository
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip title={t('agent.changes', { n: data.files.length })} aria-label={t('agent.changes', { n: data.files.length })}>
          <FileText size={12} />
          <span>{data.files.length}</span>
          {(data.added > 0 || data.deleted > 0) && (
            <>
              <span className="opacity-50">•</span>
              <span className="text-ok">+{data.added}</span>
              {data.deleted > 0 && <span className="text-danger">-{data.deleted}</span>}
            </>
          )}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="max-w-[460px]"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActiveSession();
        }}
      >
        <DropdownMenuLabel>{data.files.length ? t('agent.changes', { n: data.files.length }) : t('agent.changesNone')}</DropdownMenuLabel>
        {data.files.map((f) => (
          <DropdownMenuItem key={f.path} onSelect={() => useSessions.getState().openViewer(sessionId, f.path, f.status.includes('D') ? 'file' : 'diff')}>
            <span className={`w-5 shrink-0 font-mono text-[10px] ${statusColor(f.status)}`}>{f.status.trim() || 'M'}</span>
            <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>
              {f.path}
            </span>
            {(f.added > 0 || f.deleted > 0) && (
              <span className="shrink-0 text-[10px]">
                <span className="text-ok">+{f.added}</span> <span className="text-danger">-{f.deleted}</span>
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
