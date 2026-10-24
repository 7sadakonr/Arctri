import { ArrowDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { syncErrorText } from '@/lib/git-sync';
import { useT } from '@/lib/i18n';
import { useGitSyncStore } from '@/stores/git-sync';
import { useUi } from '@/stores/ui';
import { usePreWork } from './preWork';

/** Shown before an agent started from Arctri's own buttons begins to change files. Updating is offered, never done by itself. */
export function PreWorkCheckDialog() {
  const t = useT();
  const request = usePreWork((s) => s.request);
  const close = usePreWork((s) => s.close);
  const [busy, setBusy] = useState(false);
  const snap = request?.snap;
  const files = request?.dirtyFiles ?? [];
  // the update runs through a tab that works in this repository; without one the sidebar's button is the way
  const tab = useGitSyncStore((st) => (snap ? Object.keys(st.bySession).find((id) => st.bySession[id]?.repoId === snap.repoId) : undefined));
  const canUpdate = !!tab && !!snap && snap.status === 'behind' && !snap.dirtyOnDisk && !snap.unsavedInArctri.length && !snap.activeAgent;
  const update = async () => {
    if (!snap || busy) return;
    setBusy(true);
    try {
      const r = await api.gitSync.update(tab ?? '', {
        ...(snap.headSha ? { head: snap.headSha } : {}), ...(snap.upstream ? { upstream: snap.upstream } : {})
      });
      if (r.ok) {
        useUi.getState().toast(t('sync.updated'));
        close(true);
      } else useUi.getState().toast(syncErrorText(r), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && close(false)}>
      <DialogContent title={t('sync.preTitle')} closeLabel={t('common.close')}>
        {snap && (
          <div data-testid="prework-dialog" className="space-y-2 text-[12px] text-fg-muted">
            {snap.status === 'behind' && <p>{t('sync.preBehind', { branch: snap.branch ?? 'HEAD', upstream: snap.upstream ?? '?', n: snap.behind ?? 0 })}</p>}
            {snap.status === 'diverged' && <p className="text-danger">{t('sync.preDiverged', { branch: snap.branch ?? 'HEAD', upstream: snap.upstream ?? '?' })}</p>}
            {snap.dirtyOnDisk && files.length > 0 && (
              <div>
                <p>{t('sync.preDirty')}</p>
                <ul className="list-disc pl-5 font-mono text-fg">{files.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            )}
            {snap.unsavedInArctri.length > 0 && (
              <div>
                <p>{t('sync.preUnsaved')}</p>
                <ul className="list-disc pl-5 font-mono text-fg">{snap.unsavedInArctri.slice(0, 10).map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            )}
            {snap.status === 'offline' && <p className="text-warn">{t('sync.preOffline')}</p>}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => close(false)}>{t('sync.preCancel')}</Button>
          {snap?.status === 'behind' && (
            <Button variant="outline" size="sm" data-testid="prework-update" disabled={busy || !canUpdate} onClick={() => void update()}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}{t('sync.update')}
            </Button>
          )}
          <Button size="sm" data-testid="prework-continue" disabled={busy} onClick={() => close(true)}>{t('sync.preContinue')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
