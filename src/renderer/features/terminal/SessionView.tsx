import { Info, Square, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { formatDuration } from '@shared/i18n';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { FOCUS_SESSION_EVENT } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { useBlocks } from '@/stores/blocks';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { Asterisk, Hexagon } from 'lucide-react';
import { AGENT_META } from '@shared/agents/meta';
import { Sidebar } from '../sidebar/Sidebar';
import { FileViewer } from '../viewer/FileViewer';
import { BlockList } from '../blocks/BlockList';
import { CommandEditor } from '../editor/CommandEditor';
import { closeSession, restartSession } from '../launcher/actions';
import { AgentBar } from '../agents/AgentBar';
import { getHost } from './xterm-host';

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);
  return <>{formatDuration(now - since)}</>;
}

export function SessionView({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const mountRef = useRef<HTMLDivElement>(null);
  const host = getHost(info);
  const uiPhase = useSessions((s) => s.uiPhase[info.id] ?? 'unknown');
  const sidebarOpen = useUi((s) => s.prefs.sidebarOpen);
  const viewerOpen = useSessions((s) => !!s.viewer[info.id]);
  const viewerMax = useSessions((s) => !!s.viewer[info.id]?.maximized);
  const running = useBlocks((s) => s.blocks[info.id]?.findLast((b) => b.status === 'running'));

  const blockMode = info.kind === 'shell' && info.presentation === 'blocks' && info.integration === 'active';
  const ended = info.state === 'exited' || info.state === 'failed';
  const liveVisible = !blockMode || uiPhase === 'executing' || ended;
  const canType = blockMode && !ended && (uiPhase === 'prompt' || uiPhase === 'editing');

  useEffect(() => {
    if (mountRef.current) host.mount(mountRef.current);
  }, [host]);

  useEffect(() => {
    host.setActive(active);
    if (active && liveVisible) host.focus();
  }, [active, liveVisible, host]);

  // A menu or dialog that just closed hands keyboard focus back to the session.
  useEffect(() => {
    if (!active || !liveVisible) return;
    const h = () => host.focus();
    window.addEventListener(FOCUS_SESSION_EVENT, h);
    return () => window.removeEventListener(FOCUS_SESSION_EVENT, h);
  }, [active, liveVisible, host]);

  return (
    <div
      data-session={info.id}
      data-active={active}
      aria-hidden={!active}
      className={cn('absolute inset-0 flex', !active && 'pointer-events-none invisible')}
    >
      {viewerOpen && info.cwd && <FileViewer info={info} active={active} />}
      <div className={cn('flex flex-col overflow-hidden', viewerOpen && viewerMax ? 'w-0 min-w-0 flex-none' : 'min-w-[320px] flex-1')}>
      <div className="flex min-h-0 flex-1">
      <div className="relative min-h-0 min-w-0 flex-1">
        {blockMode && <BlockList sessionId={info.id} active={active} />}
        <div
          ref={mountRef}
          // Block mode reserves the top 28px for the status bar for good, so the PTY keeps one size and a
          // full-screen program's first rows are never hidden behind the bar.
          className={cn(
            'absolute inset-x-0 bottom-0',
            blockMode ? 'top-7 z-10' : 'top-0',
            // never 'visible': it would beat the 'invisible' of a hidden tab and paint this terminal over the others
            !liveVisible && 'pointer-events-none invisible'
          )}
        />
        {blockMode && liveVisible && !ended && (
          <div
            data-testid="running-bar"
            className="absolute inset-x-0 top-0 z-20 flex h-7 items-center gap-2 border-b border-border bg-panel px-3 text-[11px] text-fg-muted"
          >
              <>
                {info.runningAgent ? (
                  <>
                    {info.runningAgent.agentId === 'claude-code' ? <Asterisk size={13} className="text-orange-400" /> : <Hexagon size={13} className="text-accent" />}
                    <span className="min-w-0 flex-1 truncate text-fg" title={running?.command}>
                      {AGENT_META[info.runningAgent.agentId].name}
                      <span className="ml-2 font-mono text-fg-muted">{running?.command}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                    <span className="min-w-0 flex-1 truncate font-mono text-fg" title={running?.command}>
                      {running?.command ?? t('live.running')}
                    </span>
                  </>
                )}
                {running && <Elapsed since={running.startedAt} />}
                <Button variant="ghost" size="sm" onClick={() => api.sessions.write(info.id, '\x03')}>
                  <Square size={11} />
                  {t('live.stop')}
                </Button>
              </>
          </div>
        )}
        {info.presentation === 'blocks' && info.kind === 'shell' && !ended && info.state === 'starting' && (
          <div data-testid="starting" className="absolute inset-0 z-30 flex items-center justify-center bg-bg text-[12px] text-fg-muted">
            {t('session.starting', { shell: info.title.split(' · ')[0] ?? '' })}
          </div>
        )}
        {info.presentation === 'blocks' && info.kind === 'shell' && !ended && info.integration === 'unavailable' && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-border bg-panel px-3 py-1 text-[11px] text-fg-muted">
            <Info size={12} />
            {t('banner.noIntegration')}
          </div>
        )}
        {info.kind === 'shell' && !ended && info.integration === 'degraded' && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-border bg-panel px-3 py-1 text-[11px] text-warn">
            <TriangleAlert size={12} />
            <span className="flex-1">{t('banner.degraded')}</span>
          </div>
        )}
        {ended && (
          <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-panel px-3 py-1.5 text-[12px]">
            <span className={info.state === 'failed' || (info.exit?.code ?? 0) !== 0 ? 'text-danger' : 'text-fg-muted'}>
              {info.state === 'failed'
                ? t('session.failed', { reason: info.exit?.reason ?? '' })
                : t('session.exited', { code: info.exit?.code ?? 0 })}
            </span>
            <span className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => void restartSession(info)}>
              {t('session.restart')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void closeSession(info.id)}>
              {t('session.close')}
            </Button>
          </div>
        )}
      </div>
      </div>
      {canType && <CommandEditor sessionId={info.id} focused={active} />}
      {(info.kind === 'agent' || info.runningAgent) && <AgentBar info={info} active={active} />}
      </div>
      {sidebarOpen && info.cwd && <Sidebar info={info} active={active} />}
    </div>
  );
}
