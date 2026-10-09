import { Bot, Settings, SquareTerminal, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import type { ShellProfile } from '@shared/types/env';
import { openAgent, openShell } from './actions';
import { AGENT_HELP } from '../agents/help';

export async function refreshAgents(refresh: boolean): Promise<void> {
  const ui = useUi.getState();
  ui.setAgentsLoading(true);
  try {
    ui.setAgents(await api.agents.detect(refresh));
  } finally {
    ui.setAgentsLoading(false);
  }
}

export function NewTabMenu({
  open, onOpenChange, children
}: { open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode }) {
  const t = useT();
  const { profiles, wsl, agents, agentsLoading, openSettings } = useUi();

  useEffect(() => {
    if (!open) return;
    void api.profiles.list(true).then((r) => useUi.getState().setProfiles(r.profiles, r.wsl));
    void refreshAgents(false);
  }, [open]);

  const windows = profiles.filter((p) => p.env.kind === 'windows');
  const wslProfiles = profiles.filter((p) => p.env.kind === 'wsl');

  const row = (p: ShellProfile) => (
    <DropdownMenuItem key={p.id} onSelect={() => void openShell(p)}>
      <SquareTerminal size={13} className="opacity-70" />
      <span className="flex-1 truncate">{p.label}</span>
      {p.integration === 'blocks' && (
        <button
          type="button"
          title={t('launcher.classic')}
          aria-label={`${p.label}: ${t('launcher.classic')}`}
          className="rounded px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-border hover:text-fg"
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenChange(false);
            void openShell(p, { classic: true });
          }}
        >
          {t('toolbar.integration.unavailable')}
        </button>
      )}
    </DropdownMenuItem>
  );

  const wslMessage =
    wsl.available
      ? undefined
      : wsl.reason === 'loading'
        ? '…'
        : wsl.reason === 'not-installed'
          ? t('launcher.noWsl')
          : wsl.reason === 'disabled'
            ? t('launcher.wslDisabled')
            : wsl.reason === 'no-distros'
              ? t('launcher.wslNoDistros')
              : t('launcher.wslError');

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActiveSession();
        }}
      >
        <DropdownMenuLabel>{t('launcher.windows')}</DropdownMenuLabel>
        {windows.map(row)}
        <DropdownMenuLabel>{t('launcher.wsl')}</DropdownMenuLabel>
        {wslProfiles.map(row)}
        {wslMessage && <div className="px-2 py-1.5 text-fg-muted">{wslMessage}</div>}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('launcher.agents')}</DropdownMenuLabel>
        {agents.flatMap((a) =>
          a.environments.map((e) => {
            const envLabel = e.env.kind === 'windows' ? 'Windows' : e.env.distro;
            const profileId = e.env.kind === 'windows' ? 'powershell' : `wsl:${e.env.distro}:bash`;
            const profile = profiles.find((p) => p.id === profileId) ?? profiles.find((p) => p.env.kind === e.env.kind);
            const key = `${a.adapterId}:${envLabel}`;
            if (!e.installation) {
              return (
                <DropdownMenuItem
                  key={key}
                  onSelect={() => void api.app.openExternal(AGENT_HELP[a.adapterId])}
                  className="text-fg-muted"
                >
                  <Bot size={13} className="opacity-50" />
                  <span className="flex-1 truncate">{t('launcher.agentIn', { agent: a.displayName, env: envLabel })}</span>
                  <span className="text-[10px]">{t('launcher.agentMissing')}</span>
                </DropdownMenuItem>
              );
            }
            return (
              <DropdownMenuItem
                key={key}
                disabled={!profile}
                onSelect={() => profile && void openAgent(a.adapterId, profile.id, a.displayName)}
              >
                <Bot size={13} className="opacity-70" />
                <span className="flex-1 truncate">{t('launcher.agentIn', { agent: a.displayName, env: envLabel })}</span>
                {e.installation.version && <span className="text-[10px] text-fg-muted">{e.installation.version}</span>}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void refreshAgents(true);
          }}
        >
          <RefreshCw size={13} className={agentsLoading ? 'animate-spin opacity-70' : 'opacity-70'} />
          {t('launcher.rescan')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings(true)}>
          <Settings size={13} className="opacity-70" />
          {t('launcher.settings')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
