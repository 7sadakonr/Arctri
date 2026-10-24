import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, GitBranch, Loader2, Maximize2, Minus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { iconUrl } from '@/lib/file-icon';
import { tNow, useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { refreshChanges, refreshChangesNow, useChanges, type ChangesData } from '../agents/useChanges';
import { useGitEpoch, useGitSync } from '@/stores/git-sync';
import { GitSyncStatus } from './GitSyncStatus';
import { UpdateBranchDialog } from './UpdateBranchDialog';

type File = ChangesData['files'][number];
type Refs = NonNullable<Awaited<ReturnType<typeof api.files.refs>>>;

const statusColor = (s: string) => (s === '??' || s.includes('A') ? 'text-ok' : s.includes('D') || s.includes('U') ? 'text-danger' : 'text-warn');
export const baseName = (p: string) => p.replace(/\\/g, '/').split('/').at(-1) ?? p;
export const dirName = (p: string) => {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
};

/** `git status -s` gives two letters: what is staged, then what is not. */
export const isStaged = (status: string): boolean => status.length > 0 && status[0] !== ' ' && status[0] !== '?';
export const isUnstaged = (status: string): boolean => status === '??' || (status.length > 1 && status[1] !== ' ');
const statusKey = (status: string): 'status.modified' | 'status.added' | 'status.deleted' | 'status.renamed' | 'status.untracked' | 'status.conflicted' => {
  if (status === '??') return 'status.untracked';
  if (status.includes('U') || status === 'AA' || status === 'DD') return 'status.conflicted';
  if (status.includes('R')) return 'status.renamed';
  if (status.includes('D')) return 'status.deleted';
  if (status.includes('A')) return 'status.added';
  return 'status.modified';
};

/** A clear checkbox: filled accent square with a tick, or a dash when only some are included (as in Zed's git panel). */
function Tick({ checked, mixed, disabled, label, testId, onChange }: {
  checked: boolean; mixed: boolean; disabled: boolean; label: string; testId: string; onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const dash = mixed && !checked;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = dash;
  }, [dash]);
  return (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0">
      <input
        ref={ref}
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        title={label}
        aria-label={label}
        onChange={onChange}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-default"
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none flex h-full w-full items-center justify-center rounded-[5px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 peer-disabled:opacity-50',
          checked || dash ? 'border-accent bg-accent text-accent-fg' : 'border-fg-muted/70 bg-bg hover:border-accent'
        )}
      >
        {checked ? <Check size={13} strokeWidth={3.5} /> : dash ? <Minus size={13} strokeWidth={3.5} /> : null}
      </span>
    </span>
  );
}

// the message being written survives switching between the views of the sidebar
const drafts = new Map<string, string>();

/** Source control: write a message and commit, stage files one by one, publish or push. Clicking a file shows its diff. */
export function ChangesView({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const data = useChanges(info.id, active);
  const [message, setMessage] = useState(() => drafts.get(info.id) ?? '');
  const [busy, setBusy] = useState<'commit' | 'push' | 'fetch' | 'pull' | 'stage' | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  // the file whose diff is open in the viewer is the selected row
  const selected = useSessions((s) => {
    const v = s.viewer[info.id];
    const tab = v?.tabs.find((x) => x.rel === v.active);
    return tab && tab.mode === 'diff' && !tab.rev ? (tab.path ?? tab.rel).replace(/\\/g, '/') : undefined;
  });
  // what the user just ticked, shown at once while git catches up; dropped when the fresh status arrives
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const stageQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [refs, setRefs] = useState<Refs | null | undefined>(undefined);
  const snap = useGitSync(info.id);
  const epoch = useGitEpoch(info.id);
  const [updating, setUpdating] = useState(false);

  const loadRefs = useCallback(async () => {
    try {
      setRefs(await api.files.refs(info.id));
    } catch {
      /* keep what is shown */
    }
  }, [info.id]);
  const signature = data ? data.files.map((f) => `${f.status}${f.path}`).join('\n') : '';
  useEffect(() => {
    void loadRefs();
  }, [loadRefs, info.gitBranch, signature, epoch, snap?.fetchedAt, snap?.headSha]);

  useEffect(() => {
    drafts.set(info.id, message);
  }, [info.id, message]);

  /** on: in the commit, mixed: only some of its changes are, off: not. */
  const stateOf = (f: File): 'on' | 'mixed' | 'off' => {
    const o = optimistic[f.path];
    if (o !== undefined) return o ? 'on' : 'off';
    return isStaged(f.status) ? (isUnstaged(f.status) ? 'mixed' : 'on') : 'off';
  };
  const states = (data?.files ?? []).map(stateOf);
  const stagedCount = states.filter((x) => x !== 'off').length;
  const allTicked = states.length > 0 && states.every((x) => x === 'on');
  const someTicked = stagedCount > 0 && !allTicked;

  const current = refs?.local.find((b) => b.name === refs.current);
  // The one button next to the branch name does what is most useful now (as in Zed); the arrow beside it offers all three.
  const remoteActions = {
    fetch: { busy: 'fetch', icon: RefreshCw, label: t('sidebar.fetch'), title: t('sidebar.fetchHint'), run: () => api.files.fetch(info.id), done: tNow('sidebar.fetched') },
    update: { busy: 'pull', icon: ArrowDown, label: t('sync.update'), title: t('sync.updateHint'), run: undefined, done: undefined },
    push: { busy: 'push', icon: ArrowUp, label: t('sidebar.push'), title: t('sidebar.pushHint', { name: current?.upstream ?? current?.name ?? '' }), run: () => api.files.push(info.id), done: tNow('sidebar.pushed') }
  } as const;
  const behindN = snap?.behind ?? current?.behind ?? 0;
  const aheadN = snap?.ahead ?? current?.ahead ?? 0;
  const status = snap?.status;
  const primary: { act: keyof typeof remoteActions | 'resolve'; label: string; title?: string } =
    status === 'diverged'
      ? { act: 'resolve', label: t('sync.resolve'), title: t('sync.resolveHint') }
      : status === 'no-upstream' || (!snap && current && !current.upstream)
        ? { act: 'push', label: t('sidebar.publish'), title: t('sidebar.publishHint', { name: snap?.branch ?? current?.name ?? '' }) }
        : status === 'behind' || (!snap && behindN)
          ? { act: 'update', label: t('sync.updateN', { n: behindN }) }
          : status === 'ahead' || (!snap && aheadN)
            ? { act: 'push', label: t('sidebar.pushN', { n: aheadN }) }
            : { act: 'fetch', label: t('sidebar.fetch') };
  const fetching = status === 'fetching' || busy === 'fetch';
  const doRemote = (k: keyof typeof remoteActions | 'resolve') => {
    if (k === 'resolve') return undefined;
    if (k === 'update') {
      setUpdating(true);
      return undefined;
    }
    const a = remoteActions[k];
    return run(a.busy, a.run, a.done);
  };

  /** Runs one git action; a refusal is shown with git's own words. */
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) => {
    setBusy(kind);
    try {
      const r = await fn();
      if (!r.ok) useUi.getState().toast(tNow('sidebar.gitFailed', { reason: r.error }), 'error');
      else if (done) useUi.getState().toast(done);
      return r.ok;
    } catch {
      useUi.getState().toast(tNow('sidebar.gitFailed', { reason: '?' }), 'error');
      return false;
    } finally {
      setBusy(undefined);
      refreshChanges(info.id);
      void loadRefs();
    }
  };

  /** Ticks or unticks files: the box answers at once, git runs behind it one change at a time, then the real status replaces the guess. */
  const tick = (paths: string[] | 'all', on: boolean) => {
    const all = data?.files.map((f) => f.path) ?? [];
    const touched = paths === 'all' ? all : paths;
    setOptimistic((o) => ({ ...o, ...Object.fromEntries(touched.map((p) => [p, on])) }));
    stageQueue.current = stageQueue.current.then(async () => {
      try {
        const r = await (on ? api.files.stage(info.id, paths) : api.files.unstage(info.id, paths));
        if (!r.ok) useUi.getState().toast(tNow('sidebar.gitFailed', { reason: r.error }), 'error');
      } catch {
        useUi.getState().toast(tNow('sidebar.gitFailed', { reason: '?' }), 'error');
      }
      await refreshChangesNow(info.id);
      setOptimistic((o) => Object.fromEntries(Object.entries(o).filter(([p]) => !touched.includes(p))));
    });
  };

  const commit = async () => {
    if (!message.trim() || busy) return;
    await stageQueue.current; // ticks still being written to git come first
    if (await run('commit', () => api.files.commit(info.id, message), tNow('sidebar.committed'))) setMessage('');
  };

  if (!data) return <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.notGit')}</div>;

  const total = data.files.length;
  const canCommit = !!message.trim() && stagedCount > 0 && !busy;

  const commitHint = stagedCount === 0 ? t('sidebar.commitNeedsFiles') : !message.trim() ? t('sidebar.commitNeedsMessage') : undefined;
  const commitButton = (
    <Button
      variant="default"
      size="sm"
      data-testid="commit-button"
      className="rounded-none"
      title={commitHint}
      disabled={!canCommit}
      onClick={() => {
        setExpanded(false);
        void commit();
      }}
    >
      {busy === 'commit' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      {stagedCount > 0 ? t('sidebar.commitN', { n: stagedCount }) : t('sidebar.commit')}
    </Button>
  );
  const messageField = (big: boolean) => (
    <textarea
      data-testid={big ? 'commit-message-expanded' : 'commit-message'}
      autoFocus={big}
      value={message}
      rows={big ? 14 : Math.min(10, Math.max(5, message.split('\n').length + 1))}
      placeholder={t('sidebar.commitPlaceholder')}
      aria-label={t('sidebar.commitPlaceholder')}
      spellCheck={false}
      onChange={(e) => setMessage(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
          e.preventDefault();
          setExpanded(false);
          void commit();
        }
      }}
      className={cn(
        'block w-full resize-none bg-transparent px-3 py-2 text-[12px] text-fg outline-none',
        big ? 'border border-border bg-bg' : 'pr-9'
      )}
    />
  );

  /** Ticking a file puts it in the next commit (git: stage); unticking takes it out. A file that is only partly staged counts as unticked. */
  const toggle = (f: File) => tick([f.path], stateOf(f) !== 'on');

  const row = (f: File) => {
    const ticked = stateOf(f) === 'on';
    const partly = stateOf(f) === 'mixed';
    const isSelected = selected === f.path.replace(/\\/g, '/');
    return (
      <div
        key={f.path}
        data-path={f.path}
        data-ticked={ticked}
        data-selected={isSelected}
        aria-current={isSelected ? 'true' : undefined}
        className={cn(
          'flex items-center gap-2 pl-3 pr-3 text-[12px] text-fg-muted hover:bg-hover hover:text-fg focus-within:bg-hover',
          ticked && 'bg-accent/5',
          isSelected && 'bg-accent/15 text-fg shadow-[inset_2px_0_0_0_var(--ad-accent)] hover:bg-accent/20'
        )}
      >
        <button
          type="button"
          title={f.path}
          onClick={() => useSessions.getState().openViewer(info.id, f.path, f.status.includes('D') ? 'file' : 'diff', { preview: true })}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <img src={iconUrl(baseName(f.path), false)} alt="" width={16} height={16} draggable={false} className="shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-fg">{baseName(f.path)}</span>
            {dirName(f.path) && <span className="truncate text-[10px] text-fg-muted">{dirName(f.path)}</span>}
          </span>
        </button>
        <span
          className="w-[68px] shrink-0 text-right font-mono text-[10px] tabular-nums"
          title={t('sidebar.linesChanged', { added: f.added, deleted: f.deleted })}
        >
          {(f.added > 0 || f.deleted > 0) && (
            <>
              <span className="text-ok">+{f.added}</span> <span className="text-danger">−{f.deleted}</span>
            </>
          )}
        </span>
        <span className={cn('w-[58px] shrink-0 rounded border border-current/30 py-px text-center text-[10px] leading-4', statusColor(f.status))}>
          {t(statusKey(f.status))}
        </span>
        <Tick
          testId="file-tick"
          checked={ticked}
          mixed={partly}
          disabled={false}
          label={t(ticked ? 'sidebar.unstageTip' : 'sidebar.stageTip')}
          onChange={() => void toggle(f)}
        />
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border bg-panel">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <button
            type="button"
            data-testid="branch-name"
            title={t('sidebar.branches')}
            onClick={() => void api.prefs.set({ sidebarView: 'branches' }).then((p) => useUi.getState().setPrefs(p), () => undefined)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] text-fg hover:bg-hover"
          >
            <GitBranch size={13} className="shrink-0 text-fg-muted" />
            <span className="truncate">{refs?.current ?? info.gitBranch ?? 'HEAD'}</span>
          </button>
          <div className="flex shrink-0 items-stretch border border-border" data-testid="remote-button">
            <button
              type="button"
              data-testid="remote-primary"
              title={primary.title ?? (primary.act === 'resolve' ? undefined : remoteActions[primary.act].title)}
              disabled={!!busy || !refs || primary.act === 'resolve' || (primary.act === 'fetch' && fetching)}
              onClick={() => void doRemote(primary.act)}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-fg hover:bg-hover disabled:opacity-50"
            >
              {primary.act === 'resolve'
                ? <AlertTriangle size={12} />
                : busy === remoteActions[primary.act].busy || (primary.act === 'fetch' && fetching)
                  ? <Loader2 size={12} className="animate-spin" />
                  : (() => { const Icon = remoteActions[primary.act].icon; return <Icon size={12} />; })()}
              {primary.label}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="remote-menu"
                  aria-label={t('sidebar.remoteMenu')}
                  disabled={!!busy || !refs}
                  className="flex items-center border-l border-border px-1 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
                >
                  <ChevronDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                {(['fetch', 'update', 'push'] as const).map((k) => {
                  const Icon = remoteActions[k].icon;
                  return (
                    <DropdownMenuItem key={k} onSelect={() => void doRemote(k)}>
                      <Icon size={13} className="opacity-70" />
                      <span className="flex-1">{remoteActions[k].label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <GitSyncStatus sessionId={info.id} snap={snap} />
        <div className="border-y border-border bg-bg focus-within:border-accent/60">
          <div className="relative">
            {messageField(false)}
            <button
              type="button"
              title={t('sidebar.expandMessage')}
              aria-label={t('sidebar.expandMessage')}
              onClick={() => setExpanded(true)}
              className="absolute right-2 top-2 p-1 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Maximize2 size={12} />
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 pb-2">
            <div data-testid="commit-help" className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
              {total === 0
                ? t('sidebar.commitNothing')
                : stagedCount > 0
                  ? t('sidebar.commitStaged', { n: stagedCount })
                  : t('sidebar.commitSelect')}
            </div>
            {commitButton}
          </div>
        </div>
      </div>
      <UpdateBranchDialog sessionId={info.id} snap={snap} open={updating} onOpenChange={setUpdating} />
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent title={t('sidebar.commitTitle')} closeLabel={t('common.close')} className="w-[640px] max-w-[92vw]">
          {messageField(true)}
          <div className="mt-3 flex items-center justify-end gap-2">
            <div className="flex-1 text-[11px] text-fg-muted">
              {stagedCount > 0 ? t('sidebar.commitStaged', { n: stagedCount }) : t('sidebar.commitSelect')}
            </div>
            {commitButton}
          </div>
        </DialogContent>
      </Dialog>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-border bg-panel px-3 py-1.5 text-[11px] font-semibold text-fg">
          <span className="flex-1 truncate">{t('sidebar.gitChanges')} · {total}</span>
          <button type="button" title={t('sidebar.refresh')} aria-label={t('sidebar.refresh')}
            onClick={() => { refreshChanges(info.id); void loadRefs(); }}
            className="rounded p-0.5 hover:bg-hover hover:text-fg"><RefreshCw size={12} /></button>
          <Tick
            testId="tick-all"
            checked={allTicked}
            mixed={someTicked}
            disabled={total === 0}
            label={t(allTicked ? 'sidebar.unstageAll' : 'sidebar.stageAll')}
            onChange={() => tick('all', !allTicked)}
          />
        </div>
        {total === 0 && <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.upToDate')}</div>}
        <div className="divide-y divide-border/50">{data.files.map(row)}</div>
      </div>
    </div>
  );
}
