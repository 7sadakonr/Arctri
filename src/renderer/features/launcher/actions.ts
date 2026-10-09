import type { EnvPath, ShellProfile } from '@shared/types/env';
import type { AgentId, AgentLaunchOptions, SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { tNow } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { disposeHost } from '../terminal/xterm-host';
import { useBlocks } from '@/stores/blocks';

const INITIAL = { cols: 120, rows: 30 };

export function defaultProfile(): ShellProfile | undefined {
  const { profiles, prefs } = useUi.getState();
  return profiles.find((p) => p.id === prefs.defaultProfile) ?? profiles[0];
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export async function openShell(
  profile: ShellProfile | undefined,
  opts: { classic?: boolean; cwd?: EnvPath; title?: string } = {}
): Promise<SessionInfo | undefined> {
  if (!profile) return undefined;
  const { prefs } = useUi.getState();
  try {
    const info = await api.sessions.create({
      profileId: profile.id,
      kind: 'shell',
      ...INITIAL,
      presentation: opts.classic ? 'classic' : prefs.defaultPresentation,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.title ? { title: opts.title } : {})
    });
    useSessions.getState().upsert(info, true);
    if (info.launchNote === 'cwd-unmapped') useUi.getState().toast(tNow('session.cwdFallback'));
    return info;
  } catch (e) {
    useUi.getState().toast(tNow('session.failed', { reason: errText(e) }), 'error');
    return undefined;
  }
}

/** A new tab for the shell the user is currently in, in the same folder. */
export async function openSimilarTab(): Promise<void> {
  const { activeId, infos } = useSessions.getState();
  const cur = activeId ? infos[activeId] : undefined;
  const profile = cur && cur.kind === 'shell' ? useUi.getState().profiles.find((p) => p.id === cur.profileId) : undefined;
  await openShell(profile ?? defaultProfile(), cur?.cwd && cur.kind === 'shell' ? { cwd: cur.cwd } : {});
}

/** What each agent tab was started with, so Restart and Resume can start the same agent again. */
const agentLaunches = new Map<string, { adapterId: AgentId; profileId: string; displayName: string; options: AgentLaunchOptions }>();
export const agentLaunchOf = (id: string) => agentLaunches.get(id);

export async function openAgent(
  adapterId: AgentId,
  profileId: string,
  displayName: string,
  options: AgentLaunchOptions = {},
  cwd?: EnvPath
): Promise<SessionInfo | undefined> {
  // Opening an agent is always a deliberate action; the trace makes an unexpected one easy to attribute.
  console.info('[agentdock] openAgent', adapterId, profileId, new Error().stack);
  try {
    const info = await api.sessions.create({
      profileId,
      kind: 'agent',
      ...INITIAL,
      agent: { adapterId, options },
      ...(cwd ? { cwd } : {})
    });
    agentLaunches.set(info.id, { adapterId, profileId, displayName, options });
    useSessions.getState().upsert(info, true);
    return info;
  } catch (e) {
    useUi.getState().toast(tNow('agent.launchFailed', { agent: displayName, reason: errText(e) }), 'error');
    return undefined;
  }
}

/**
 * The tab disappears at once; ending the process tree (which can take a second or two) continues in the
 * background in the main process.
 */
export async function closeSession(id: string): Promise<void> {
  agentLaunches.delete(id);
  disposeHost(id);
  useBlocks.getState().drop(id);
  useSessions.getState().remove(id);
  try {
    await api.sessions.close(id);
  } catch {
    /* the session is already gone from the UI; nothing else to do */
  }
}

/** Starts the same shell or agent again in the same folder and closes the ended tab. */
export async function restartSession(info: SessionInfo): Promise<void> {
  const cwd = info.cwd;
  let next: SessionInfo | undefined;
  if (info.kind === 'agent') {
    const l = agentLaunchOf(info.id);
    if (l) next = await openAgent(l.adapterId, l.profileId, l.displayName, l.options, cwd);
  } else {
    const profile = useUi.getState().profiles.find((p) => p.id === info.profileId);
    next = await openShell(profile, { ...(cwd ? { cwd } : {}), classic: info.presentation === 'classic' });
  }
  if (next) await closeSession(info.id);
}

/** A plain shell in the environment and folder of the given session. */
export async function openShellHere(info: SessionInfo): Promise<void> {
  const { profiles } = useUi.getState();
  const profile =
    info.env.kind === 'wsl'
      ? profiles.find((p) => p.env.kind === 'wsl' && p.env.distro === (info.env as { distro: string }).distro && p.shell === 'bash') ??
        profiles.find((p) => p.env.kind === 'wsl')
      : defaultProfile();
  await openShell(profile, info.cwd ? { cwd: info.cwd } : {});
}
