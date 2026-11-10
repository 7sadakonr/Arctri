import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useAgentStatus } from '@/stores/agent-status';
import { useSessions } from '@/stores/sessions';
import { StatusIndicator } from '../attention/StatusIndicator';
import { tabLabel, useTabStatus } from '../attention/status-view';

function Row({ id }: { id: string }) {
  const { info, status, agent } = useTabStatus(id);
  if (!info) return null;
  const folder = info.cwd?.path.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return (
    <li className="flex items-center gap-2 py-1">
      {status && <StatusIndicator status={status} unread={!!agent?.unread} />}
      <span className="truncate text-fg">{tabLabel(info)}</span>
      {folder && <span className="truncate font-mono text-[11px] text-fg-muted">{folder}</span>}
    </li>
  );
}

/**
 * Asked by the main process when the user quits (or closes the window) while tabs still run something.
 * Cancel leaves everything alone; Quit tells the main process to go on, which ends the sessions.
 */
export function QuitConfirmDialog() {
  const t = useT();
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    const off = api.app.onConfirmQuit(({ sessionIds }) => setIds(sessionIds));
    void api.app.quitPromptReady();
    return off;
  }, []);
  // only tabs that still exist; the list is what the main process saw a moment ago
  const infos = useSessions((s) => s.infos);
  useAgentStatus((s) => s.byId);
  const shown = (ids ?? []).filter((id) => infos[id]);
  return (
    <Dialog open={ids !== null} onOpenChange={(o) => !o && setIds(null)}>
      <DialogContent title={t('quit.title')} closeLabel={t('common.close')}>
        <div data-testid="quit-dialog" className="space-y-2 text-[12px] text-fg-muted">
          <p>{t('quit.body', { count: shown.length || (ids?.length ?? 0) })}</p>
          <ul className="max-h-60 overflow-auto rounded-md border border-border bg-bg px-2.5 py-1">
            {shown.map((id) => <Row key={id} id={id} />)}
          </ul>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" autoFocus data-testid="quit-cancel" onClick={() => setIds(null)}>{t('quit.cancel')}</Button>
          <Button variant="danger" size="sm" data-testid="quit-confirm" onClick={() => void api.app.quitConfirmed()}>{t('quit.confirm')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
