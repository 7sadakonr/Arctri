import { useEffect, useState } from 'react';
import type { Prefs } from '@shared/prefs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { focusActiveSession } from '@/lib/focus';
import { tNow, useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11px] text-fg-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const field =
  'h-7 rounded-md border border-border bg-bg px-2 text-xs text-fg outline-none focus:border-accent/60';

export function SettingsDialog() {
  const t = useT();
  const open = useUi((s) => s.settingsOpen);
  const prefs = useUi((s) => s.prefs);
  const profiles = useUi((s) => s.profiles);
  const agents = useUi((s) => s.agents);
  const [agentPaths, setAgentPaths] = useState<Record<string, string>>(prefs.agentPaths);

  useEffect(() => {
    if (open) setAgentPaths(useUi.getState().prefs.agentPaths);
  }, [open]);

  const save = async (patch: Partial<Prefs>) => {
    try {
      useUi.getState().setPrefs(await api.prefs.set(patch));
    } catch {
      /* invalid values are rejected by the main process; keep the previous setting */
    }
  };

  const num = (key: 'fontSize' | 'scrollback' | 'historyLimit', min: number, max: number) => (
    <input
      type="number"
      className={`${field} w-24`}
      defaultValue={prefs[key]}
      min={min}
      max={max}
      onBlur={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v) && v >= min && v <= max) void save({ [key]: v });
        else e.target.value = String(prefs[key]);
      }}
    />
  );

  return (
    <Dialog open={open} onOpenChange={(o) => useUi.getState().openSettings(o)}>
      <DialogContent
        title={t('settings.title')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActiveSession();
        }}
      >
        <Row label={t('settings.language')}>
          <select className={field} value={prefs.language} onChange={(e) => void save({ language: e.target.value as Prefs['language'] })}>
            <option value="auto">{t('settings.language.auto')}</option>
            <option value="en">English</option>
            <option value="th">ไทย</option>
          </select>
        </Row>
        <Row label={t('settings.theme')}>
          <select className={field} value={prefs.theme} onChange={(e) => void save({ theme: e.target.value as Prefs['theme'] })}>
            <option value="dark">{t('settings.theme.dark')}</option>
            <option value="light">{t('settings.theme.light')}</option>
          </select>
        </Row>
        <Row label={t('settings.fontSize')}>{num('fontSize', 9, 28)}</Row>
        <Row label={t('settings.scrollback')} hint={t('settings.restartNote')}>
          {num('scrollback', 1000, 200000)}
        </Row>
        <Row label={t('settings.defaultProfile')}>
          <select
            className={`${field} max-w-[220px]`}
            value={prefs.defaultProfile ?? ''}
            onChange={(e) => void save({ defaultProfile: e.target.value || undefined } as Partial<Prefs>)}
          >
            <option value="">—</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.defaultPresentation')}>
          <select
            className={field}
            value={prefs.defaultPresentation}
            onChange={(e) => void save({ defaultPresentation: e.target.value as Prefs['defaultPresentation'] })}
          >
            <option value="blocks">{t('settings.presentation.blocks')}</option>
            <option value="classic">{t('settings.presentation.classic')}</option>
          </select>
        </Row>
        <Row label={t('settings.restoreTabs')}>
          <Switch checked={prefs.restoreTabs} onCheckedChange={(v) => void save({ restoreTabs: v })} />
        </Row>
        <Row label={t('settings.conpty')} hint={t('settings.restartNote')}>
          <select className={field} value={prefs.conptyMode} onChange={(e) => void save({ conptyMode: e.target.value as Prefs['conptyMode'] })}>
            <option value="bundled">{t('settings.conpty.bundled')}</option>
            <option value="inbox">{t('settings.conpty.inbox')}</option>
          </select>
        </Row>
        <Row label={t('settings.osc52')}>
          <Switch checked={prefs.osc52} onCheckedChange={(v) => void save({ osc52: v })} />
        </Row>
        <Row label={t('settings.agentNotifications')}>
          <Switch checked={prefs.agentNotifications} onCheckedChange={(v) => void save({ agentNotifications: v })} />
        </Row>
        <Row label={t('settings.historyLimit')}>{num('historyLimit', 100, 200000)}</Row>
        <Row label={t('settings.history')}>
          <Button
            variant="outline"
            onClick={async () => {
              await api.history.clear();
              useUi.getState().toast(tNow('settings.historyCleared'));
            }}
          >
            {t('settings.clearHistory')}
          </Button>
        </Row>

        <div className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{t('settings.agents')}</div>
        {agents.flatMap((a) =>
          a.environments
            .filter((e) => !e.stopped)
            .map((e) => {
              const envName = e.env.kind === 'windows' ? 'Windows' : e.env.distro;
              const key = `${a.adapterId}:${e.env.kind === 'windows' ? 'windows' : `wsl:${e.env.distro}`}`;
              return (
                <Row key={key} label={t('settings.agentPath', { agent: a.displayName, env: envName })} hint={t('settings.agentPathHint')}>
                  <input
                    className={`${field} w-56 font-mono`}
                    value={agentPaths[key] ?? ''}
                    placeholder={e.installation?.resolvedPath ?? ''}
                    onChange={(ev) => setAgentPaths({ ...agentPaths, [key]: ev.target.value })}
                    onBlur={() => {
                      const clean = Object.fromEntries(Object.entries(agentPaths).filter(([, v]) => v.trim()));
                      void save({ agentPaths: clean }).then(() => api.agents.detect(true).then((r) => useUi.getState().setAgents(r)));
                    }}
                  />
                </Row>
              );
            })
        )}

        <div className="pt-4">
          <Button
            variant="outline"
            onClick={async () => {
              const d = await api.app.diagnostics();
              await copyText(JSON.stringify(d, null, 2));
              useUi.getState().toast(tNow('settings.diagnosticsCopied'));
            }}
          >
            {t('settings.diagnostics')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
