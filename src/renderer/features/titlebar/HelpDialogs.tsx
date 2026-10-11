import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+Shift+T', 'menu.newTerminal'],
  ['Ctrl+K Ctrl+O', 'menu.openFolder'],
  ['Ctrl+Shift+W', 'menu.closeTab'],
  ['Ctrl+Tab / Ctrl+Shift+Tab', 'menu.nextTab'],
  ['Ctrl+1 … 9', 'menu.gotoTab'],
  ['Ctrl+↑ / Ctrl+↓', 'menu.selectBlock'],
  ['F2', 'menu.renameTab'],
  ['Ctrl+Shift+E', 'menu.filesPanel'],
  ['Ctrl+L', 'menu.clearTerminal'],
  ['Ctrl+=', 'menu.zoomIn'],
  ['Ctrl+-', 'menu.zoomOut'],
  ['Ctrl+0', 'menu.zoomReset'],
  ['Ctrl+,', 'menu.settings']
];

/** Keyboard Shortcuts and About, opened from the Help menu. */
export function HelpDialogs() {
  const t = useT();
  const which = useUi((s) => s.helpDialog);
  const [diag, setDiag] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (which === 'about') void api.app.diagnostics().then(setDiag, () => undefined);
  }, [which]);
  const close = () => useUi.getState().setHelpDialog(null);

  return (
    <Dialog open={which !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title={which === 'about' ? t('menu.about') : t('menu.shortcuts')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActiveSession();
        }}
      >
        {which === 'shortcuts' && (
          <table className="w-full text-[12px]">
            <tbody>
              {SHORTCUTS.map(([keys, label], i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-4 font-mono text-fg-muted">{keys}</td>
                  <td className="py-1.5">{t(label as never)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {which === 'about' && (
          <div className="text-[13px]">
            <div className="text-base font-semibold">Arctri</div>
            <div className="mt-1 text-fg-muted">
              {t('menu.aboutBuild', { app: String(diag['app'] ?? ''), electron: String(diag['electron'] ?? '') })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
