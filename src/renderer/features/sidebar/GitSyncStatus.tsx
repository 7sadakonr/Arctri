import { AlertTriangle, ArrowDown, ArrowUp, Check, CloudOff, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RepoSyncSnapshot } from '@shared/git/sync';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useLang, useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/relative-time';
import { useUi } from '@/stores/ui';
import { syncErrorText } from '@/lib/git-sync';

/** The words and colour for where the branch stands against its upstream. */
export function useSyncLabel(snap: RepoSyncSnapshot | undefined): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted'; icon: typeof Check } {
  const t = useT();
  if (!snap) return { text: t('sync.unknown'), tone: 'muted', icon: GitBranch };
  switch (snap.status) {
    case 'fetching': return { text: t('sync.fetching'), tone: 'muted', icon: Loader2 };
    case 'up-to-date': return { text: t('sync.upToDate'), tone: 'ok', icon: Check };
    case 'behind': return { text: t('sync.behind', { n: snap.behind ?? 0 }), tone: 'warn', icon: ArrowDown };
    case 'ahead': return { text: t('sync.ahead', { n: snap.ahead ?? 0 }), tone: 'ok', icon: ArrowUp };
    case 'diverged': return { text: t('sync.diverged', { ahead: snap.ahead ?? 0, behind: snap.behind ?? 0 }), tone: 'danger', icon: AlertTriangle };
    case 'no-upstream': return { text: t('sync.noUpstream'), tone: 'muted', icon: GitBranch };
    case 'detached': return { text: t('sync.detached'), tone: 'muted', icon: GitBranch };
    case 'offline': return { text: snap.remoteError?.code === 'AUTH_REQUIRED' ? t('sync.authRequired') : t('sync.offline'), tone: 'warn', icon: CloudOff };
    default: return { text: t('sync.unknown'), tone: 'muted', icon: GitBranch };
  }
}

const tone = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', muted: 'text-fg-muted' } as const;

/** A compact line: where the branch stands, when the server was last asked, and a way to ask again. */
export function GitSyncStatus({ sessionId, snap }: { sessionId: string; snap: RepoSyncSnapshot | undefined }) {
  const t = useT();
  const lang = useLang();
  const label = useSyncLabel(snap);
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);
  const Icon = label.icon;
  const fetching = snap?.status === 'fetching';
  const retry = async () => {
    const r = await api.gitSync.fetch(sessionId).catch(() => undefined);
    if (r && !r.ok) useUi.getState().toast(syncErrorText(r), 'error');
  };
  const checked = snap?.fetchedAt ? t('sync.checked', { when: relativeTime(snap.fetchedAt / 1000, lang) }) : t('sync.never');
  return (
    <div data-testid="git-sync-status" data-status={snap?.status ?? 'unknown'} className="flex items-center gap-1.5 px-3 py-1 text-[11px]">
      <Icon size={12} className={cn('shrink-0', tone[label.tone], fetching && 'animate-spin')} />
      <span className={cn('min-w-0 truncate', tone[label.tone])} title={snap?.remoteError?.message}>{label.text}</span>
      <span className="min-w-0 flex-1 truncate text-fg-muted" title={snap?.fetchedAt ? new Date(snap.fetchedAt).toLocaleString() : undefined}>· {checked}</span>
      {(snap?.status === 'offline' || snap?.status === 'unknown' || !snap) && !fetching && (
        <button
          type="button"
          data-testid="git-sync-retry"
          onClick={() => void retry()}
          className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <RefreshCw size={10} />
          {t('sync.retry')}
        </button>
      )}
    </div>
  );
}

