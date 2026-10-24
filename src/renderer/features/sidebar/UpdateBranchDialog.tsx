import { ArrowDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { RepoSyncSnapshot } from '@shared/git/sync';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { syncErrorText } from '@/lib/git-sync';
import { useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import { refreshChanges } from '../agents/useChanges';

/** Why the update cannot go ahead now, from what the main process knows (it checks again before it acts). */
export function updateBlockers(snap: RepoSyncSnapshot): Array<'sync.blockedAgent' | 'sync.blockedUnsaved' | 'sync.blockedDirty'> {
  const out: Array<'sync.blockedAgent' | 'sync.blockedUnsaved' | 'sync.blockedDirty'> = [];
  if (snap.activeAgent) out.push('sync.blockedAgent');
  if (snap.unsavedInArctri.length) out.push('sync.blockedUnsaved');
  if (snap.dirtyOnDisk) out.push('sync.blockedDirty');
  return out;
}

/** Asks before bringing the new commits in, naming the branch and the exact upstream. Fast-forward only. */
export function UpdateBranchDialog({ sessionId, snap, open, onOpenChange }: {
  sessionId: string; snap: RepoSyncSnapshot | undefined; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const blockers = snap ? updateBlockers(snap) : [];
  const run = async () => {
    if (!snap || busy) return;
    setBusy(true);
    try {
      const r = await api.gitSync.update(sessionId, {
        ...(snap.headSha ? { head: snap.headSha } : {}), ...(snap.upstream ? { upstream: snap.upstream } : {})
      });
      if (!r.ok) useUi.getState().toast(syncErrorText(r), 'error');
      else {
        const key = r.message === 'updated' ? 'sync.updated' : r.message === 'ahead' ? 'sync.aheadOnly' : 'sync.alreadyUpToDate';
        useUi.getState().toast(t(key));
      }
      onOpenChange(false);
    } catch {
      useUi.getState().toast(syncErrorText({ ok: false, code: 'FAILED', error: '?' }), 'error');
    } finally {
      setBusy(false);
      refreshChanges(sessionId);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('sync.updateTitle')} closeLabel={t('common.close')}>
        {snap && (
          <div data-testid="update-dialog" className="text-[12px] text-fg-muted">
            {t('sync.updateBody', { branch: snap.branch ?? 'HEAD', upstream: snap.upstream ?? '?', n: snap.behind ?? 0 })}
          </div>
        )}
        {blockers.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-[12px] text-warn">{blockers.map((b) => <li key={b}>{t(b)}</li>)}</ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button size="sm" data-testid="update-confirm" disabled={busy || !snap || blockers.length > 0} onClick={() => void run()}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}{t('sync.updateConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
