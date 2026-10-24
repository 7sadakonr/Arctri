import { ArrowDown, ArrowUp, Check, GitBranch, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BRANCH_QUICK_SWITCH_EVENT } from '@/lib/branch-events';
import { cn } from '@/lib/cn';
import { tNow, useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import { refreshChanges } from '../agents/useChanges';
import { useGitEpoch, useGitSync } from '@/stores/git-sync';
import { GitSyncStatus } from './GitSyncStatus';
import { UpdateBranchDialog } from './UpdateBranchDialog';

/** Mirrors the rules the main process applies before `git switch -c`. */
const NEW_BRANCH = /^[A-Za-z0-9_][\w./+-]*$/;
const validNewBranch = (n: string) =>
  NEW_BRANCH.test(n) && !n.includes('..') && !n.includes('//') && !/[/.]$/.test(n) && !n.endsWith('.lock') && !n.split('/').some((p) => p.startsWith('.') || p.endsWith('.lock'));

type Refs = NonNullable<Awaited<ReturnType<typeof api.files.refs>>>;
type Branch = Refs['local'][number];


/** Local and remote branches. Clicking one switches to it. */
export function BranchesView({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const [refs, setRefs] = useState<Refs | null | undefined>(undefined); // undefined: loading, null: not a repository
  const [filter, setFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const cwd = info.cwd?.path;
  const snap = useGitSync(info.id);
  const epoch = useGitEpoch(info.id);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      setRefs(await api.files.refs(info.id));
    } catch {
      /* keep what is shown */
    }
  }, [info.id]);

  useEffect(() => {
    void load();
  }, [load, cwd, info.gitBranch, epoch, snap?.fetchedAt, snap?.headSha]);
  useEffect(() => {
    if (!active) return;
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [active, load]);
  useEffect(() => {
    if (!active) return;
    const focus = () => requestAnimationFrame(() => searchRef.current?.focus());
    window.addEventListener(BRANCH_QUICK_SWITCH_EVENT, focus);
    return () => window.removeEventListener(BRANCH_QUICK_SWITCH_EVENT, focus);
  }, [active]);

  const maySwitch = async (): Promise<boolean> => {
    const gate = await api.files.branchPreflight(info.id);
    if (!gate.ok) {
      useUi.getState().toast(tNow('sidebar.gitFailed', { reason: gate.error ?? '?' }), 'error');
      return false;
    }
    return !gate.dirty || window.confirm(t('sidebar.dirtySwitch'));
  };

  const [switching, setSwitching] = useState<string | undefined>(undefined);

  /** Switches at once through git (no command is typed into the terminal); git's refusal is shown as it is. */
  const switchTo = async (name: string, remote: boolean) => {
    if (switching) return;
    if (!(await maySwitch())) return;
    setSwitching(name);
    try {
      const r = await api.files.switchBranch(info.id, name, remote);
      if (!r.ok) useUi.getState().toast(tNow('sidebar.gitFailed', { reason: r.error }), 'error');
    } catch {
      useUi.getState().toast(tNow('sidebar.gitFailed', { reason: '?' }), 'error');
    } finally {
      setSwitching(undefined);
      void load();
      refreshChanges(info.id);
    }
  };

  const finish = async (r: { ok: true } | { ok: false; error: string }, done?: string) => {
    if (!r.ok) useUi.getState().toast(tNow('sidebar.gitFailed', { reason: r.error }), 'error');
    else if (done) useUi.getState().toast(done);
    void load();
    refreshChanges(info.id);
    return r.ok;
  };

  const createBranch = async () => {
    const name = newName.trim();
    if (!validNewBranch(name) || busy) return;
    if (!(await maySwitch())) return;
    setBusy(true);
    try {
      if (await finish(await api.files.createBranch(info.id, name), tNow('sidebar.createdBranch', { name }))) {
        setCreating(false);
        setNewName('');
      }
    } finally {
      setBusy(false);
    }
  };

  const pushBranch = async () => {
    setBusy(true);
    try {
      await finish(await api.files.push(info.id), tNow('sidebar.pushed'));
    } finally {
      setBusy(false);
    }
  };

  const lowered = filter.toLowerCase();
  const pick = (list: Branch[]) => list.filter((b) => !lowered || b.name.toLowerCase().includes(lowered));
  const local = useMemo(() => pick(refs?.local ?? []), [refs, lowered]);
  const remote = useMemo(() => pick(refs?.remote ?? []), [refs, lowered]);

  if (refs === undefined) return <div className="px-3 py-3 text-[12px] text-fg-muted">…</div>;
  if (refs === null) return <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.notGit')}</div>;

  const row = (b: Branch, isRemote: boolean) => {
    const current = !isRemote && b.name === refs.current;
    // the current branch's numbers come from the shared reading (it knows when the server was last asked)
    const ahead = current && snap ? (snap.ahead ?? 0) : b.ahead;
    const behind = current && snap ? (snap.behind ?? 0) : b.behind;
    return (
      <div
        key={`${isRemote ? 'r' : 'l'}:${b.name}`}
        data-branch={b.name}
        role="button"
        tabIndex={current ? -1 : 0}
        aria-current={current ? 'true' : undefined}
        title={current ? t('sidebar.current') : `${t('sidebar.switchTo', { name: b.name })}${isRemote ? ` · ${t('sidebar.remoteTip')}` : ''}`}
        onClick={() => !current && void switchTo(b.name, isRemote)}
        onKeyDown={(e) => {
          if (!current && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            void switchTo(b.name, isRemote);
          }
        }}
        className={cn(
          'group flex w-full items-center gap-2 px-3 py-1 text-left text-[12px]',
          current ? 'cursor-default text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
        )}
      >
        {switching === b.name ? <Loader2 size={12} className="shrink-0 animate-spin" /> : current ? <Check size={12} className="shrink-0 text-ok" /> : <GitBranch size={12} className="shrink-0 opacity-60" />}
        <span className={cn('min-w-0 flex-1 truncate', current && 'font-semibold')}>{b.name}</span>
        {!!ahead && <span className="shrink-0 text-[10px] text-ok">{t('sidebar.toUpload', { n: ahead })}</span>}
        {!!behind && <span className="shrink-0 text-[10px] text-warn">{t('sidebar.toDownload', { n: behind })}</span>}
        {current && snap?.status === 'behind' && (
          <span
            role="button"
            tabIndex={0}
            data-testid="branch-update"
            title={t('sync.updateHint')}
            onClick={(e) => {
              e.stopPropagation();
              setUpdating(true);
            }}
            className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-border hover:text-fg"
          >
            <ArrowDown size={11} />
            {t('sync.update')}
          </span>
        )}
        {current && (!b.upstream || !!ahead) && snap?.status !== 'diverged' && (
          <span
            role="button"
            tabIndex={0}
            data-testid="branch-push"
            title={b.upstream ? t('sidebar.pushHint', { name: b.upstream }) : t('sidebar.publishHint', { name: b.name })}
            onClick={(e) => {
              e.stopPropagation();
              if (!busy) void pushBranch();
            }}
            className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-border hover:text-fg"
          >
            <ArrowUp size={11} />
            {b.upstream ? t('sidebar.pushN', { n: ahead ?? 0 }) : t('sidebar.publish')}
          </span>
        )}
        {!current && (
          <span className="invisible shrink-0 text-[10px] group-hover:visible">
            {switching === b.name ? t('sidebar.switching') : t('sidebar.switch')}
          </span>
        )}
      </div>
    );
  };

  const heading = (text: string) => (
    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-fg-muted">{text}</div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <input
          ref={searchRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('files.filter')}
          aria-label={t('files.filter')}
          className="h-6 min-w-0 flex-1 rounded border border-border bg-bg px-2 text-[12px] text-fg outline-none focus:border-accent/60"
        />
        <button
          type="button"
          data-testid="new-branch"
          title={t('sidebar.newBranch')}
          aria-label={t('sidebar.newBranch')}
          onClick={() => setCreating(true)}
          className={cn('flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-fg-muted hover:bg-hover hover:text-fg', creating && 'bg-hover text-fg')}
        >
          <Plus size={14} />
          <span className="text-[11px]">{t('sidebar.newBranch')}</span>
        </button>
        <button type="button" title={t('sidebar.refresh')} aria-label={t('sidebar.refresh')} onClick={() => void load()}
          className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"><RefreshCw size={14} /></button>
      </div>
      <GitSyncStatus sessionId={info.id} snap={snap} />
      <UpdateBranchDialog sessionId={info.id} snap={snap} open={updating} onOpenChange={setUpdating} />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={t('sidebar.newBranch')} closeLabel={t('viewer.close')}>
          <div className="mb-2 text-[12px] text-fg-muted">{t('sidebar.createFrom', { name: refs.current ?? 'HEAD' })}</div>
          <input
            autoFocus
            data-testid="new-branch-name"
            value={newName}
            disabled={busy}
            placeholder={t('sidebar.branchName')}
            aria-label={t('sidebar.branchName')}
            spellCheck={false}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void createBranch();
              } else if (e.key === 'Escape') {
                setCreating(false);
                setNewName('');
              }
            }}
            className={cn(
              'h-8 w-full rounded border bg-bg px-2 font-mono text-[12px] text-fg outline-none',
              newName && !validNewBranch(newName.trim()) ? 'border-danger/70' : 'border-border focus:border-accent/60'
            )}
          />
          {newName && !validNewBranch(newName.trim()) && <div className="pt-1 text-[11px] text-danger">{t('sidebar.invalidBranch')}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreating(false)}>{t('welcome.cloneCancel')}</Button>
            <Button size="sm" disabled={busy || !validNewBranch(newName.trim())} onClick={() => void createBranch()}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}{t('sidebar.createAndSwitch')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {local.some((b) => b.name === refs.current) && heading(t('sidebar.current'))}
        {local.filter((b) => b.name === refs.current).map((b) => row(b, false))}
        {local.some((b) => b.name !== refs.current) && heading(t('sidebar.local'))}
        {local.filter((b) => b.name !== refs.current).map((b) => row(b, false))}
        {remote.length > 0 && heading(t('sidebar.remote'))}
        {remote.map((b) => row(b, true))}
        {local.length === 0 && remote.length === 0 && <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.noBranches')}</div>}
      </div>
    </div>
  );
}
