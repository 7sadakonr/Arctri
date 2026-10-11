import { isWindows, kbd } from '@/lib/platform';
import { SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import type { ShellProfile } from '@shared/types/env';
import { blockProfiles, openShell, resolveDefaultProfile } from './actions';

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
  const { profiles, wsl } = useUi();

  useEffect(() => {
    if (!open) return;
    void api.profiles.list(true).then((r) => useUi.getState().setProfiles(r.profiles, r.wsl, r.defaultProfileId));
  }, [open]);

  const row = (p: ShellProfile) => (
    <DropdownMenuItem key={p.id} onSelect={() => void openShell(p)} className={/^wsl:.+:(zsh|bash)$/.test(p.id) ? 'pl-7' : undefined}>
      <SquareTerminal size={13} className="opacity-70" />
      <span className="flex-1 truncate">{p.label}</span>
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
        <DropdownMenuItem onSelect={() => void resolveDefaultProfile().then(openShell)}>
          <SquareTerminal size={13} className="opacity-70" />
          <span className="flex-1 truncate">{t('launcher.terminal')}</span>
          <span className="text-[10px] text-fg-muted">{kbd("Ctrl+Shift+T")}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {blockProfiles(profiles).map(row)}
        {isWindows && wslMessage && <div className="px-2 py-1.5 text-fg-muted">{wslMessage}</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
