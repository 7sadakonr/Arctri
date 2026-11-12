import { AgentLogo } from './AgentLogo';
import {
  ChevronDown, Folder, FolderOpen, History, MessageSquarePlus, MoreHorizontal, Paperclip, Radio, RotateCcw, Settings, TriangleAlert, X
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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
import { useAgentStatus } from '@/stores/agent-status';
import { useAttachments } from '@/stores/attachments';
import { useUi } from '@/stores/ui';
import { agentLaunchOf, closeSession, openAgent, openShellHere, restartSession } from '../launcher/actions';
import { sendCommand } from './commands';
import { ChangesChip } from './ChangesChip';
import { Chip } from './Chip';
import { AttachmentChips } from './AttachmentChips';
import { attachFiles, insertAttachments } from './insert';
import { RichInput } from './RichInput';
import { useChanges } from './useChanges';

export const TOGGLE_RICH_EVENT = 'arctri:toggle-rich';

const Glyph = ({ agent, size = 16 }: { agent: AgentId; size?: number }) => <AgentLogo agent={agent} size={size} />;

const Divider = () => <span aria-hidden className="h-4 w-px shrink-0 bg-border" />;

/** A secondary action: shown inline when the bar is wide, in the "⋯" menu when it is narrow. */
type Action = { id: string; icon: ReactNode; label: string; hint?: string; onSelect: () => void };

/**
 * Whether a horizontally scrolling strip has more content to the left / right, kept up to date on scroll, resize and when
 * children change. When a child is added the strip scrolls to the end, so the new attachment is in view.
 */
function useOverflowEdges(ref: RefObject<HTMLDivElement | null>, mounted: boolean) {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    let count = el.childElementCount;
    const mo = new MutationObserver(() => {
      if (el.childElementCount > count) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
      count = el.childElementCount;
      update();
    });
    const ro = new ResizeObserver(update);
    mo.observe(el, { childList: true });
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      mo.disconnect();
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, [ref, mounted]);
  return edges;
}

const fadeMask = ({ left, right }: { left: boolean; right: boolean }) => {
  if (!left && !right) return undefined;
  const g = `linear-gradient(to right, ${left ? 'transparent, black 16px' : 'black'}, ${right ? 'black calc(100% - 16px), transparent' : 'black'})`;
  return { maskImage: g, WebkitMaskImage: g };
};

/**
 * The bar shown while an agent is in the conversation: a tab that IS an agent, or a shell tab in which the user started
 * one. Its controls depend on the agent, and a control appears only if it can really do its job.
 *
 * Layout: identity | input tools (attach, changes, commands, rich input) … secondary actions | folder | settings.
 * Attachments, when there are any, get a row of their own above. The controls row condenses by container width instead of
 * wrapping:
 *   < @lg   icons only: file count without line counts, "/" without chevron, folder as an icon (path in its tooltip)
 *   @lg     line counts, folder path text
 *   @2xl    secondary actions inline instead of the "⋯" menu, "Rich Input" label
 *   @3xl    model name, "Ctrl G"
 *   @4xl    labels on the secondary actions
 * The folder path is the one control that shrinks, so the row stays a single line down to about 340px.
 */
export function AgentBar({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const agentId = (info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId) as AgentId;
  const meta = AGENT_META[agentId];
  const ownsTab = info.kind === 'agent';
  const running = info.state === 'running';
  const model = useAgentStatus((s) => s.byId[info.id]?.model);
  const caps = info.agentCaps;
  const [rich, setRich] = useState(false);
  const changes = useChanges(info.id, active && running);
  const launch = agentLaunchOf(info.id);
  const envName = envLabel(info.env);
  const commands = caps?.nativeCommands ?? meta.nativeCommands;
  const stripRef = useRef<HTMLDivElement>(null);
  const hasAttachments = useAttachments((s) => (s.bySession[info.id]?.length ?? 0) > 0);
  const edges = useOverflowEdges(stripRef, hasAttachments);

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

  const actions: Action[] = [];
  if (meta.remoteControl && running) {
    const rc = meta.remoteControl;
    actions.push({
      id: 'remote-control',
      icon: <Radio size={14} />,
      label: t('agent.remoteControl'),
      hint: t('agent.sendCommand', { text: rc.text, agent: meta.name, hint: rc.hint }),
      onSelect: () => sendCommand(info.id, rc.text)
    });
  }
  if (ownsTab && caps?.resumeLast && launch) {
    actions.push({
      id: 'resume',
      icon: <History size={14} />,
      label: t('agent.resume'),
      onSelect: () => void openAgent(launch.adapterId, launch.profileId, launch.displayName, { ...launch.options, resume: 'last' }, info.cwd)
    });
  }
  if (ownsTab) {
    actions.push({ id: 'open-shell', icon: <FolderOpen size={14} />, label: t('agent.openShell'), onSelect: () => void openShellHere(info) });
  }

  return (
    <div className="shrink-0">
      {info.unsafeLaunch && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-md border border-danger/50 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          <TriangleAlert size={12} />
          {t('agent.unsafeFlags')}
        </div>
      )}
      {rich && running && <RichInput sessionId={info.id} onClose={closeRich} />}
      {hasAttachments && (
        <div
          ref={stripRef}
          data-testid="attachment-strip"
          onWheel={(e) => {
            const el = stripRef.current;
            // a mouse wheel only scrolls vertically; turn that into sideways scrolling here
            if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
          }}
          style={fadeMask(edges)}
          className="flex h-11 items-center gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <AttachmentChips sessionId={info.id} />
        </div>
      )}
      <div className="@container">
        <div data-testid="agent-bar" data-agent={agentId} className="flex h-12 items-center gap-1.5 overflow-hidden px-3 text-xs text-fg-muted">
          {/* identity + input tools. The bar condenses step by step as the pane narrows (see the doc comment above) instead of
              wrapping: in a wrapping row the folder path would jump to a new line rather than shrink. */}
          <div className="contents">
            <Tip label={model ? `${meta.name} · ${envName} · ${model}` : `${meta.name} · ${envName}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center" data-testid="agent-glyph">
                <Glyph agent={agentId} />
              </span>
            </Tip>

            {running && model && (
              <Tip label={t('agent.model', { model })}>
                <span data-testid="agent-model" className="hidden max-w-[180px] shrink-0 truncate font-mono text-xs text-fg-muted @3xl:inline-block">
                  {model}
                </span>
              </Tip>
            )}

            {running && <Divider />}

            {running && (
              <Tip label={t('agent.attach')}>
                <Chip
                  aria-label={t('agent.attach')}
                  onClick={async () => {
                    insertAttachments(info.id, await attachFiles(info.id));
                    focusActiveSession();
                  }}
                  className="w-7 justify-center px-0"
                >
                  <Paperclip size={14} />
                </Chip>
              </Tip>
            )}

            <ChangesChip sessionId={info.id} data={changes} />

            {running && commands.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Chip aria-label="/" className="@max-lg:w-7 @max-lg:justify-center @max-lg:px-0">
                    /
                    <ChevronDown size={12} className="hidden @lg:block" />
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
                <Chip active={rich} aria-label={t('agent.richInput')} aria-pressed={rich} onClick={() => setRich((v) => !v)}>
                  <MessageSquarePlus size={14} />
                  <span className="hidden @2xl:inline">{t('agent.richInput')}</span>
                  <span className="hidden font-mono text-[10px] opacity-60 @3xl:inline">Ctrl G</span>
                </Chip>
              </Tip>
            )}
          </div>

          {/* pushes the actions to the right */}
          <span aria-hidden className="min-w-0 flex-1 basis-0" />

          {/* actions + context; the folder path is what shrinks */}
          <div className="contents">
            {ownsTab && !running && (
              <>
                <Tip label={t('agent.restart')}>
                  <Chip aria-label={t('agent.restart')} onClick={() => void restartSession(info)}>
                    <RotateCcw size={14} />
                    <span className="hidden @md:inline">{t('agent.restart')}</span>
                  </Chip>
                </Tip>
                <Tip label={t('session.close')}>
                  <Chip aria-label={t('session.close')} onClick={() => void closeSession(info.id)}>
                    <X size={14} />
                    <span className="hidden @md:inline">{t('session.close')}</span>
                  </Chip>
                </Tip>
              </>
            )}

            {actions.map((a) => (
              <Tip key={a.id} label={a.hint ?? a.label}>
                <Chip aria-label={a.label} onClick={a.onSelect} className="hidden @2xl:inline-flex">
                  {a.icon}
                  <span className="hidden @4xl:inline">{a.label}</span>
                </Chip>
              </Tip>
            ))}

            {actions.length > 0 && (
              <DropdownMenu>
                <Tip label={t('agent.more')}>
                  <DropdownMenuTrigger asChild>
                    <Chip aria-label={t('agent.more')} className="w-7 justify-center px-0 @2xl:hidden">
                      <MoreHorizontal size={14} />
                    </Chip>
                  </DropdownMenuTrigger>
                </Tip>
                <DropdownMenuContent
                  align="end"
                  side="top"
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    focusActiveSession();
                  }}
                >
                  {actions.map((a) => (
                    <DropdownMenuItem key={a.id} onSelect={a.onSelect} title={a.hint}>
                      {a.icon}
                      <span>{a.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {actions.length > 0 && (
              <span className="hidden @lg:contents">
                <Divider />
              </span>
            )}

            {info.cwd && (
              <Tip
                label={
                  <span className="flex flex-col gap-0.5">
                    <span className="break-all font-mono">{info.cwd.path}</span>
                    <span className="text-[10px] opacity-70">{t('toolbar.copyPathHint')}</span>
                  </span>
                }
              >
                <Chip
                  aria-label={`${t('toolbar.copyPath')}: ${info.cwd.path}`}
                  onClick={() => void copyText(info.cwd!.path).then(() => useUi.getState().toast(tNow('block.copied')))}
                  onDoubleClick={() => void api.app.openPath(info.id)}
                  className="min-w-0 shrink @max-lg:w-7 @max-lg:shrink-0 @max-lg:justify-center @max-lg:px-0 @lg:min-w-10 @lg:max-w-[140px] @2xl:max-w-[200px] @4xl:max-w-[320px]"
                >
                  <Folder size={14} className="shrink-0" />
                  <span className="hidden truncate @lg:inline" dir="rtl">
                    <bdi>{info.cwd.path}</bdi>
                  </span>
                </Chip>
              </Tip>
            )}
            <Tip label={t('launcher.settings')}>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('launcher.settings')} onClick={() => useUi.getState().openSettings(true)}>
                <Settings size={15} />
              </Button>
            </Tip>
          </div>
        </div>
      </div>
    </div>
  );
}
