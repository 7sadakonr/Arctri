import { Check, GitBranch } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { tNow, useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import { refreshChanges } from '../agents/useChanges';

type Refs = NonNullable<Awaited<ReturnType<typeof api.files.refs>>>;
type Branch = Refs['local'][number];

/** Names that are safe to put in a command line as they are (no spaces, quotes, `$`, leading dash). */
const SAFE_BRANCH = /^[A-Za-z0-9_][\w./+-]*$/;

/** Local and remote branches. Clicking one types `git switch <branch>` into the tab's terminal, so its result is seen there. */
export function BranchesView({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const [refs, setRefs] = useState<Refs | null | undefined>(undefined); // undefined: loading, null: not a repository
  const [filter, setFilter] = useState('');
  const cwd = info.cwd?.path;

  const load = useCallback(async () => {
    try {
      setRefs(await api.files.refs(info.id));
    } catch {
      /* keep what is shown */
    }
  }, [info.id]);

  useEffect(() => {
    void load();
  }, [load, cwd, info.gitBranch]);
  useEffect(() => {
    if (!active) return;
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [active, load]);

  const switchTo = async (name: string, remote: boolean) => {
    // `origin/feature` is switched to as `feature`: git creates the tracking branch itself
    const target = remote ? name.replace(/^[^/]+\//, '') : name;
    if (!SAFE_BRANCH.test(target)) {
      useUi.getState().toast(tNow('sidebar.badBranch'), 'error');
      return;
    }
    const r = await api.sessions.submit(info.id, `git switch ${target}`);
    if (!r.ok) {
      useUi.getState().toast(tNow('editor.notReady'), 'error');
      return;
    }
    setTimeout(() => {
      void load();
      refreshChanges(info.id);
    }, 1500);
  };

  const lowered = filter.toLowerCase();
  const pick = (list: Branch[]) => list.filter((b) => !lowered || b.name.toLowerCase().includes(lowered));
  const local = useMemo(() => pick(refs?.local ?? []), [refs, lowered]);
  const remote = useMemo(() => pick(refs?.remote ?? []), [refs, lowered]);

  if (refs === undefined) return <div className="px-3 py-3 text-[12px] text-fg-muted">…</div>;
  if (refs === null) return <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.notGit')}</div>;

  const row = (b: Branch, isRemote: boolean) => {
    const current = !isRemote && b.name === refs.current;
    return (
      <button
        key={`${isRemote ? 'r' : 'l'}:${b.name}`}
        type="button"
        data-branch={b.name}
        disabled={current}
        title={current ? t('sidebar.current') : t('sidebar.switchTo', { name: b.name })}
        onClick={() => void switchTo(b.name, isRemote)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1 text-left text-[12px]',
          current ? 'cursor-default text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
        )}
      >
        {current ? <Check size={12} className="shrink-0 text-ok" /> : <GitBranch size={12} className="shrink-0 opacity-60" />}
        <span className={cn('min-w-0 flex-1 truncate', current && 'font-semibold')}>{b.name}</span>
        {!!b.ahead && <span className="shrink-0 text-[10px] text-ok">↑{b.ahead}</span>}
        {!!b.behind && <span className="shrink-0 text-[10px] text-warn">↓{b.behind}</span>}
      </button>
    );
  };

  const heading = (text: string) => (
    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{text}</div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-2 py-1">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('files.filter')}
          aria-label={t('files.filter')}
          className="h-6 w-full rounded border border-border bg-bg px-2 text-[12px] text-fg outline-none focus:border-accent/60"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {local.length > 0 && heading(t('sidebar.local'))}
        {local.map((b) => row(b, false))}
        {remote.length > 0 && heading(t('sidebar.remote'))}
        {remote.map((b) => row(b, true))}
        {local.length === 0 && remote.length === 0 && <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.noBranches')}</div>}
      </div>
    </div>
  );
}
