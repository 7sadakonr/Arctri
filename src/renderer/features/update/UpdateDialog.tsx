import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { useUpdate } from '@/stores/update';
import { updateSummary } from './summary';

/** Installs the downloaded update. Refused while work is running unless the user confirms. */
export async function installUpdate(confirmBusy: boolean): Promise<void> {
  const r = await api.update.install(confirmBusy);
  if (!r.started && r.blocked === 'busy') useUpdate.getState().setBusy(r.busy);
}

export function UpdateDialog() {
  const t = useT();
  const open = useUpdate((s) => s.dialogOpen);
  const status = useUpdate((s) => s.status);
  const busy = useUpdate((s) => s.busy);
  const close = () => useUpdate.getState().openDialog(false);
  const phase = status?.phase;
  const canAuto = status?.canAutoInstall ?? false;
  const version = phase && 'version' in phase ? phase.version : undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title={t('update.title')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActiveSession();
        }}
      >
        <div className="text-[13px]" data-testid="update-dialog">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
            <dt className="text-fg-muted">{t('update.current')}</dt>
            <dd className="font-mono">{status?.currentVersion ?? '–'}</dd>
            {version && (
              <>
                <dt className="text-fg-muted">{t('update.latest')}</dt>
                <dd className="font-mono">{version}</dd>
              </>
            )}
          </dl>

          <div className="mt-3" data-testid="update-summary" role="status">
            {updateSummary(t, status)}
          </div>
          {phase?.kind === 'downloading' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-hover" role="progressbar" aria-valuenow={phase.percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent transition-[width]" style={{ width: `${phase.percent}%` }} />
            </div>
          )}
          {(phase?.kind === 'available' || phase?.kind === 'downloaded') && !canAuto && (
            <div className="mt-2 text-[12px] text-fg-muted">{t('update.manualOnly')}</div>
          )}
          {canAuto && (phase?.kind === 'available' || phase?.kind === 'downloading' || phase?.kind === 'downloaded') && (
            <div className="mt-2 text-[12px] text-fg-muted">{t('update.unsigned')}</div>
          )}
          {busy !== null && (
            <div className="mt-3 rounded-md border border-border bg-bg p-2.5 text-[12px]" data-testid="update-busy" role="alert">
              {t('update.busy', { count: busy })}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {busy !== null ? (
              <>
                <Button onClick={() => void installUpdate(true)} data-testid="update-restart-anyway">{t('update.restartAnyway')}</Button>
                <Button variant="outline" onClick={() => useUpdate.getState().setBusy(null)}>{t('update.later')}</Button>
              </>
            ) : (
              <>
                {phase?.kind === 'available' && canAuto && (
                  <Button onClick={() => void api.update.download()} data-testid="update-download">{t('update.download')}</Button>
                )}
                {phase?.kind === 'available' && !canAuto && (
                  <Button onClick={() => void api.update.openReleasePage()}>{t('update.downloadFromGitHub')}</Button>
                )}
                {phase?.kind === 'downloaded' && canAuto && (
                  <Button onClick={() => void installUpdate(false)} data-testid="update-restart">{t('update.restart')}</Button>
                )}
                {(phase?.kind === 'idle' || phase?.kind === 'up-to-date' || phase?.kind === 'error') && (
                  <Button variant="outline" onClick={() => void api.update.check()} data-testid="update-check">
                    {phase.kind === 'error' ? t('update.retry') : t('update.checkNow')}
                  </Button>
                )}
                {version && (
                  <Button variant="outline" onClick={() => void api.update.openReleasePage()}>{t('update.releaseNotes')}</Button>
                )}
                <Button variant="outline" onClick={close}>{t('update.later')}</Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
