import { envLabel } from '@shared/types/env';
import type { AgentId } from '@shared/types/agent';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { isWindows } from '@/lib/platform';
import { useUi } from '@/stores/ui';
import { AGENT_HELP } from '../agents/help';

const REPO = 'https://github.com/7sadakonr/Arctri';

function Link({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <a href={url} className="text-accent hover:underline" onClick={(e) => { e.preventDefault(); void api.app.openExternal(url); }}>
      {children}
    </a>
  );
}

/**
 * What Arctri found on this machine and whether it can use it: shells, WSL, agent CLIs. Everything optional is marked as such,
 * and a missing piece says how to get it; a normal terminal never depends on any of it.
 */
export function EnvironmentPanel({ version }: { version?: string }) {
  const t = useT();
  const profiles = useUi((s) => s.profiles);
  const wsl = useUi((s) => s.wsl);
  const agents = useUi((s) => s.agents);
  const loading = useUi((s) => s.agentsLoading);
  const shells = profiles.filter((p) => p.env.kind !== 'wsl');
  const distros = profiles.filter((p) => p.env.kind === 'wsl');
  const wslMessage = (() => {
    if (wsl.available) return undefined;
    switch (wsl.reason) {
      case 'loading': return t('env.wslLoading');
      case 'not-installed': return `${t('launcher.noWsl')}. ${t('recover.wslInstall')}`;
      case 'disabled': return `${t('launcher.wslDisabled')}. ${t('recover.wslInstall')}`;
      case 'no-distros': return `${t('launcher.wslNoDistros')}. ${t('recover.wslDistro')}`;
      default: return `${t('launcher.wslError')}. ${t('recover.wsl')}`;
    }
  })();

  return (
    <div className="text-[12px]" data-testid="environment-panel">
      <div className="mb-1 text-fg-muted">{t('env.shells')}</div>
      {shells.length === 0 && <div className="px-2 py-1 text-warn">{t('env.noShells')}</div>}
      {shells.map((p) => (
        <div key={p.id} className="flex gap-2 px-2 py-0.5">
          <span>{p.label}</span>
          <span className="text-fg-muted">{p.integration === 'blocks' ? t('env.shellBlocks') : t('env.shellClassic')}</span>
        </div>
      ))}

      {(isWindows || distros.length > 0) && (
        <>
          <div className="mb-1 mt-3 text-fg-muted">{t('launcher.wsl')}</div>
          {wsl.available && distros.length > 0 ? (
            distros.map((p) => (
              <div key={p.id} className="flex gap-2 px-2 py-0.5">
                <span>{p.label}</span>
                <span className="text-fg-muted">{p.integration === 'blocks' ? t('env.shellBlocks') : t('env.shellClassic')}</span>
              </div>
            ))
          ) : (
            <div className="px-2 py-0.5 text-fg-muted" data-testid="env-wsl">{wslMessage ?? t('launcher.wslNoDistros')}</div>
          )}
        </>
      )}

      <div className="mb-1 mt-3 text-fg-muted">{t('env.agents')}</div>
      {loading && agents.length === 0 && <div className="px-2 py-0.5 text-fg-muted">{t('env.checking')}</div>}
      {agents.map((a) => {
        const found = a.environments.filter((e) => e.installation);
        return (
          <div key={a.adapterId} className="px-2 py-0.5" data-testid={`env-agent-${a.adapterId}`}>
            <span>{a.displayName}</span>{' '}
            {found.length > 0 ? (
              <span className="text-fg-muted">
                {found.map((e) => `${envLabel(e.env)}${e.installation?.version ? ` ${e.installation.version}` : ''}`).join(' · ')}
              </span>
            ) : (
              <span className="text-fg-muted">
                {t('launcher.agentMissing')} · <Link url={AGENT_HELP[a.adapterId as AgentId]}>{t('launcher.installHelp')}</Link>
              </span>
            )}
          </div>
        );
      })}
      <div className="px-2 pt-1 text-fg-muted">{t('env.agentsNote')}</div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-2 pt-2 text-fg-muted">
        {version && <span>Arctri {version}</span>}
        <Link url={`${REPO}#readme`}>{t('env.docs')}</Link>
        <Link url={`${REPO}/issues/new/choose`}>{t('env.support')}</Link>
      </div>
    </div>
  );
}
