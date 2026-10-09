import { Folder, GitBranch, PanelRight, Settings, TerminalSquare } from 'lucide-react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { tNow, useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { AgentBar } from '../agents/AgentBar';

function envLabel(info: SessionInfo): string {
  return info.env.kind === 'windows' ? `Windows · ${info.shell}` : `${info.env.distro} · ${info.shell}`;
}

export function ShellToolbar({ info }: { info: SessionInfo }) {
  const t = useT();
  const blockMode = info.presentation === 'blocks' && info.integration === 'active';
  const native = useSessions((s) => !!s.nativePrompt[info.id]);
  const explorerOpen = useSessions((s) => !!s.explorer[info.id]);
  const integ = info.integration;
  const tone =
    integ === 'active' ? 'text-ok' : integ === 'degraded' ? 'text-warn' : integ === 'pending' ? 'text-fg-muted' : 'text-fg-muted';

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 px-3 text-[11px] text-fg-muted">
      <span className="flex items-center gap-1.5 text-fg">
        <TerminalSquare size={12} />
        {envLabel(info)}
      </span>
      {info.cwd && (
        <Tip label={t('toolbar.copyPath')}>
          <button
            className="flex min-w-0 max-w-[40%] items-center gap-1 hover:text-fg"
            onClick={() => void copyText(info.cwd!.path).then(() => useUi.getState().toast(tNow('block.copied')))}
            onDoubleClick={() => void api.app.openPath(info.id)}
          >
            <Folder size={12} className="shrink-0" />
            <span className="truncate" dir="rtl">
              <bdi>{info.cwd.path}</bdi>
            </span>
          </button>
        </Tip>
      )}
      {info.gitBranch && (
        <span className="flex items-center gap-1 text-fg" title={info.gitBranch}>
          <GitBranch size={12} />
          <span className="max-w-[160px] truncate">{info.gitBranch}</span>
        </span>
      )}
      <span className="flex-1" />
      <Tip label={t('agent.filesHint')}>
        <Button variant={explorerOpen ? 'outline' : 'ghost'} size="sm" onClick={() => useSessions.getState().setExplorer(info.id, !explorerOpen)}>
          <PanelRight size={12} />
          {t('agent.files')}
        </Button>
      </Tip>
      <span className={cn('flex items-center gap-1', tone)} title={t(`toolbar.integration.${integ}` as const)}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {t(`toolbar.integration.${integ}` as const)}
      </span>
      {blockMode && (
        <Button
          variant={native ? 'outline' : 'ghost'}
          size="sm"
          onClick={() => useSessions.getState().setNativePrompt(info.id, !native)}
        >
          {t('toolbar.nativePrompt')}
        </Button>
      )}
      <Tip label={t('launcher.settings')}>
        <Button variant="ghost" size="icon" aria-label={t('launcher.settings')} onClick={() => useUi.getState().openSettings(true)}>
          <Settings size={13} />
        </Button>
      </Tip>
    </div>
  );
}

/** Variant chosen by session kind; controls appear only when they can really do their job. */
export function BottomToolbar({ info, active }: { info: SessionInfo; active: boolean }) {
  return info.kind === 'agent' || info.runningAgent ? <AgentBar info={info} active={active} /> : <ShellToolbar info={info} />;
}
