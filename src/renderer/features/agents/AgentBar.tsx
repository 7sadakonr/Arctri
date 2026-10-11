import { Asterisk, ChevronDown, Folder, FolderOpen, GitBranch, Hexagon, History, MessageSquarePlus, Paperclip, RotateCcw, Settings, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AGENT_META } from '@shared/agents/meta';
import { envLabel } from '@shared/types/env';
import type { AgentId, SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { focusActiveSession } from '@/lib/focus';
import { tNow, useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import { agentLaunchOf, closeSession, openAgent, openShellHere, restartSession } from '../launcher/actions';
import { sendCommand } from './commands';
import { ChangesChip } from './ChangesChip';
import { Chip } from './Chip';
import { attachFiles, insertText } from './insert';
import { RichInput } from './RichInput';
import { useChanges } from './useChanges';

export const TOGGLE_RICH_EVENT = 'arctri:toggle-rich';

const Glyph = ({ agent, size = 14 }: { agent: AgentId; size?: number }) =>
  agent === 'claude-code' ? <Asterisk size={size} className="text-orange-400" /> : <Hexagon size={size} className="text-accent" />;

/** Offers to switch on Codex notifications, once, and only when the configuration can really be changed. */
function CodexNotificationsChip({ sessionId }: { sessionId: string }) {
  const t = useT();
  const dismissed = useUi((s) => s.prefs.dismissedHints.includes('codex-notifications'));
  const [state, setState] = useState<'hidden' | 'offer' | 'done'>('hidden');

  useEffect(() => {
    if (dismissed) return;
    let alive = true;
    void api.agents.codexNotifications(sessionId, 'status').then((r) => alive && setState(r.available && !r.enabled ? 'offer' : 'hidden'), () => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId, dismissed]);

  if (dismissed || state === 'hidden' || state === 'done') return null;
  return (
    <span className="inline-flex h-6 items-center overflow-hidden rounded-md border border-ok/40 bg-ok/10 text-[11px] font-medium text-ok">
      <button
        className="h-full px-2 hover:bg-ok/20"
        onClick={async () => {
          const r = await api.agents.codexNotifications(sessionId, 'enable').catch(() => undefined);
          if (r?.enabled) {
            setState('done');
            useUi.getState().toast(tNow('agent.notif.enabled'));
          } else useUi.getState().toast(tNow('agent.notif.failed'), 'error');
          focusActiveSession();
        }}
      >
        {t('agent.notif.enable')}
      </button>
      <button
        aria-label={t('agent.notif.dismiss')}
        title={t('agent.notif.dismiss')}
        className="h-full px-1.5 hover:bg-ok/20"
        onClick={async () => {
          const prefs = useUi.getState().prefs;
          useUi.getState().setPrefs(await api.prefs.set({ dismissedHints: [...prefs.dismissedHints, 'codex-notifications'] }));
          focusActiveSession();
        }}
      >
        <X size={11} />
      </button>
    </span>
  );
}

/**
 * The bar shown while an agent is in the conversation: a tab that IS an agent, or a shell tab in which the user started
 * one. Its controls depend on the agent, and a control appears only if it can really do its job.
 */
export function AgentBar({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const agentId = (info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId) as AgentId;
  const meta = AGENT_META[agentId];
  const ownsTab = info.kind === 'agent';
  const running = info.state === 'running';
  const caps = info.agentCaps;
  const [rich, setRich] = useState(false);
  const changes = useChanges(info.id, active && running);
  const launch = agentLaunchOf(info.id);
  const envName = envLabel(info.env);
  const commands = caps?.nativeCommands ?? meta.nativeCommands;

  useEffect(() => {
    if (!active) return;
    const h = () => setRich((v) => !v);
    window.addEventListener(TOGGLE_RICH_EVENT, h);
    return () => window.removeEventListener(TOGGLE_RICH_EVENT, h);
  }, [active]);

  const closeRich = () => {
    setRich(false);
    focusActiveSession();
  };

  return (
    <div className="shrink-0">
      {info.unsafeLaunch && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-md border border-danger/50 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          <TriangleAlert size={12} />
          {t('agent.unsafeFlags')}
        </div>
      )}
      {rich && running && <RichInput sessionId={info.id} onClose={closeRich} />}
      <div data-testid="agent-bar" data-agent={agentId} className="flex min-h-8 flex-wrap items-center gap-1.5 px-3 py-1 text-[11px] text-fg-muted">
        <Tip label={`${meta.name} · ${envName}`}>
          <span className="flex h-6 w-6 items-center justify-center" data-testid="agent-glyph">
            <Glyph agent={agentId} />
          </span>
        </Tip>

        {running && (
          <Tip label={t('agent.attach')}>
            <Chip
              aria-label={t('agent.attach')}
              onClick={async () => {
                const refs = await attachFiles(info.id);
                if (refs.length) insertText(info.id, refs.join(' '));
                focusActiveSession();
              }}
              className="w-6 justify-center px-0"
            >
              <Paperclip size={12} />
            </Chip>
          </Tip>
        )}

        <ChangesChip sessionId={info.id} data={changes} />

        {agentId === 'codex' && running && <CodexNotificationsChip sessionId={info.id} />}

        {meta.remoteControl && running && (
          <Tip label={`${t('agent.sendCommand', { text: meta.remoteControl.text, agent: meta.name, hint: meta.remoteControl.hint })}`}>
            <Chip onClick={() => sendCommand(info.id, meta.remoteControl!.text)}>{t('agent.remoteControl')}</Chip>
          </Tip>
        )}

        {running && commands.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Chip aria-label="/">
                /
                <ChevronDown size={10} />
              </Chip>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                focusActiveSession();
              }}
            >
              {commands.map((c) => (
                <DropdownMenuItem key={c.text} onSelect={() => sendCommand(info.id, c.text)}>
                  <span className="font-mono">{c.label}</span>
                  <span className="max-w-[260px] text-[10px] text-fg-muted">
                    {t('agent.sendCommand', { text: c.text, agent: meta.name, hint: c.hint })}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {running && (
          <Tip label={t('agent.richInputHint')}>
            <Chip active={rich} onClick={() => setRich((v) => !v)}>
              <MessageSquarePlus size={12} />
              {t('agent.richInput')}
              <span className="font-mono text-[10px] opacity-60">Ctrl G</span>
            </Chip>
          </Tip>
        )}

        <span className="min-w-2 flex-1" />

        {ownsTab && caps?.resumeLast && launch && (
          <Chip
            onClick={() => void openAgent(launch.adapterId, launch.profileId, launch.displayName, { ...launch.options, resume: 'last' }, info.cwd)}
          >
            <History size={12} />
            {t('agent.resume')}
          </Chip>
        )}
        {ownsTab && !running && (
          <>
            <Chip onClick={() => void restartSession(info)}>
              <RotateCcw size={12} />
              {t('agent.restart')}
            </Chip>
            <Chip onClick={() => void closeSession(info.id)}>{t('session.close')}</Chip>
          </>
        )}
        {ownsTab && (
          <Chip onClick={() => void openShellHere(info)}>
            <FolderOpen size={12} />
            {t('agent.openShell')}
          </Chip>
        )}
        {info.cwd && (
          <Tip label={t('toolbar.copyPath')}>
            <Chip
              onClick={() => void copyText(info.cwd!.path).then(() => useUi.getState().toast(tNow('block.copied')))}
              onDoubleClick={() => void api.app.openPath(info.id)}
              className="max-w-[260px]"
            >
              <Folder size={12} className="shrink-0" />
              <span className="truncate" dir="rtl">
                <bdi>{info.cwd.path}</bdi>
              </span>
            </Chip>
          </Tip>
        )}
        {info.gitBranch && (
          <Chip className="max-w-[160px] cursor-default" tabIndex={-1} title={info.gitBranch}>
            <GitBranch size={12} className="shrink-0" />
            <span className="truncate">{info.gitBranch}</span>
          </Chip>
        )}
        <Tip label={t('launcher.settings')}>
          <Button variant="ghost" size="icon" aria-label={t('launcher.settings')} onClick={() => useUi.getState().openSettings(true)}>
            <Settings size={13} />
          </Button>
        </Tip>
      </div>
    </div>
  );
}
