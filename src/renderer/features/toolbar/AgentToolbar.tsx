import { Bot, ChevronDown, FolderOpen, MessageSquarePlus, RotateCcw, Send, Settings, TriangleAlert, History } from 'lucide-react';
import { useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import { agentLaunchOf, closeSession, openAgent, openShellHere, restartSession } from '../launcher/actions';
import { peekHost } from '../terminal/xterm-host';

const NAME: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

export function AgentToolbar({ info }: { info: SessionInfo }) {
  const t = useT();
  const [composer, setComposer] = useState(false);
  const [text, setText] = useState('');
  const composing = useRef(false);
  const caps = info.agentCaps;
  const running = info.state === 'running';
  const name = NAME[info.agentId ?? ''] ?? info.title;
  const envName = info.env.kind === 'windows' ? 'Windows' : info.env.distro;
  const launch = agentLaunchOf(info.id);

  const sendCommand = (cmd: string) => {
    api.sessions.write(info.id, cmd);
    setTimeout(() => api.sessions.write(info.id, '\r'), 60);
    peekHost(info.id)?.focus();
  };

  const pasteText = () => {
    const value = text.replace(/\s+$/, '');
    if (!value) return;
    // xterm wraps the text in bracketed-paste markers when the agent asked for them; Enter is never sent.
    peekHost(info.id)?.term.paste(value);
    setText('');
    setComposer(false);
    peekHost(info.id)?.focus();
  };

  return (
    <div className="shrink-0">
      {info.unsafeLaunch && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-md border border-danger/50 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          <TriangleAlert size={12} />
          {t('agent.unsafeFlags')}
        </div>
      )}
      {composer && running && (
        <div className="mx-3 mb-1 rounded-lg border border-border bg-panel p-2">
          <textarea
            autoFocus
            value={text}
            rows={4}
            spellCheck={false}
            placeholder={t('agent.composerHint')}
            aria-label={t('agent.composer')}
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || composing.current) return;
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                pasteText();
              }
              if (e.key === 'Escape') setComposer(false);
            }}
            className="block max-h-48 w-full resize-y bg-transparent text-[13px] leading-snug text-fg outline-none placeholder:text-fg-muted/70"
          />
          <div className="mt-1 flex justify-end">
            <Button variant="default" size="sm" onClick={pasteText} disabled={!text.trim()}>
              <Send size={12} />
              {t('agent.paste')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex h-8 items-center gap-2 px-3 text-[11px] text-fg-muted">
        <span className="flex items-center gap-1.5 text-fg">
          <Bot size={13} className="text-accent" />
          <span className="font-medium">{name}</span>
        </span>
        <span>{envName}</span>
        {info.cwd && (
          <span className="min-w-0 max-w-[30%] truncate" title={info.cwd.path} dir="rtl">
            <bdi>{info.cwd.path}</bdi>
          </span>
        )}
        <span className={cn('flex items-center gap-1', running ? 'text-ok' : 'text-fg-muted')}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {running ? t('agent.running') : `${t('agent.exited')}${info.exit?.code != null ? ` (${info.exit.code})` : ''}`}
        </span>
        {info.launchSummary && (
          <span className="min-w-0 truncate font-mono text-[10px]" title={info.launchSummary}>
            {t('agent.launchedWith')}: {info.launchSummary}
          </span>
        )}
        <span className="flex-1" />
        {running && (
          <Button variant={composer ? 'outline' : 'ghost'} size="sm" onClick={() => setComposer((c) => !c)}>
            <MessageSquarePlus size={12} />
            {t('agent.composer')}
          </Button>
        )}
        {running && caps && caps.nativeCommands.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                /<ChevronDown size={11} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              onCloseAutoFocus={(e) => {
                // keyboard focus belongs to the agent, not to the menu button
                e.preventDefault();
                peekHost(info.id)?.focus();
              }}
            >
              {caps.nativeCommands.map((c) => (
                <DropdownMenuItem key={c.text} onSelect={() => sendCommand(c.text)}>
                  <span className="font-mono">{c.label}</span>
                  <span className="max-w-[260px] text-[10px] text-fg-muted">
                    {t('agent.sendCommand', { text: c.text, agent: name, hint: c.hint })}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {caps?.resumeLast && launch && (
          <Tip label={t('agent.resume')}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void openAgent(launch.adapterId, launch.profileId, launch.displayName, { ...launch.options, resume: 'last' }, info.cwd)
              }
            >
              <History size={12} />
              {t('agent.resume')}
            </Button>
          </Tip>
        )}
        {!running && (
          <Button variant="outline" size="sm" onClick={() => void restartSession(info)}>
            <RotateCcw size={12} />
            {t('agent.restart')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void openShellHere(info)}>
          <FolderOpen size={12} />
          {t('agent.openShell')}
        </Button>
        {!running && (
          <Button variant="ghost" size="sm" onClick={() => void closeSession(info.id)}>
            {t('session.close')}
          </Button>
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
