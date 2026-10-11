import { TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { kbd } from '@/lib/platform';
import { useUi } from '@/stores/ui';

function ExternalLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        void api.app.openExternal(url);
      }}
      className="text-accent hover:underline"
    >
      {label}
    </a>
  );
}

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
                  <td className="py-1.5 pr-4 font-mono text-fg-muted">{kbd(keys)}</td>
                  <td className="py-1.5">{t(label as never)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {which === 'about' && (
          <div className="text-[13px]" data-testid="about">
            <div className="flex items-center gap-3">
              <TerminalSquare size={32} className="shrink-0 text-accent" />
              <div className="min-w-0">
                <div className="text-base font-semibold">Arctri</div>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              {([
                ['about.version', String(diag['app'] ?? '')],
                ['about.electron', String(diag['electron'] ?? '')],
                ['about.node', String(diag['node'] ?? '')],
                ['about.system', [diag['os'], diag['arch']].filter(Boolean).join(' · ')],
                ['about.license', 'MIT']
              ] as const).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-fg-muted">{t(k)}</dt>
                  <dd className="select-text font-mono">{v || '–'}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 border-t border-border pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{t('about.createdBy')}</div>
              <div className="mt-1 font-medium">Jetsadakorn Muangwichit <span className="font-normal text-fg-muted">(เจษฎากร ม่วงวิจิตร)</span></div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                <ExternalLink url="https://github.com/7sadakonr" label="GitHub @7sadakonr" />
                <ExternalLink url="https://github.com/7sadakonr/Arctri" label={t('about.source')} />
                <ExternalLink url="https://github.com/7sadakonr/Arctri/issues" label={t('about.issues')} />
              </div>
            </div>
            <div className="mt-4 text-[11px] text-fg-muted">
              <div>{t('about.thirdParty')}</div>
              <div className="mt-1">© 2026 Jetsadakorn Muangwichit · MIT License</div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
