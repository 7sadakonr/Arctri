import { Folder, GitBranch, Settings, TerminalSquare } from 'lucide-react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
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
