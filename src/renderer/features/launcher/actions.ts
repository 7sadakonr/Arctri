import type { EnvPath, ShellProfile } from '@shared/types/env';
import type { AgentId, AgentLaunchOptions, SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { tNow } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { disposeHost } from '../terminal/xterm-host';
import { useBlocks } from '@/stores/blocks';
import { pushRecent, toRecent } from '../welcome/recent';

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

/** Tabs this window has closed: updates still on their way from the main process must not bring them back. */
const closedHere = new Set<string>();
export const wasClosedHere = (id: string): boolean => closedHere.has(id);

/**
 * The tab disappears at once; ending the process tree (which can take a second or two) continues in the
 * background in the main process.
 */
export async function closeSession(id: string): Promise<void> {
  closedHere.add(id);
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

/** The profile to use for a folder: a WSL folder gets a shell of its own distribution, anything else the default. */
function profileForFolder(folder: EnvPath): ShellProfile | undefined {
  const { profiles } = useUi.getState();
  if (folder.env !== 'wsl') return defaultProfile();
  const mine = profiles.filter((p) => p.env.kind === 'wsl' && p.env.distro.toLowerCase() === folder.distro.toLowerCase());
  return mine.find((p) => p.shell === 'bash') ?? mine[0] ?? profiles.find((p) => p.env.kind === 'wsl') ?? defaultProfile();
}

async function rememberProject(folder: EnvPath): Promise<void> {
  const next = pushRecent(useUi.getState().prefs.recentProjects, toRecent(folder));
  try {
    useUi.getState().setPrefs(await api.prefs.set({ recentProjects: next }));
  } catch {
    /* the list is a convenience; the tab is already open */
  }
}

/** A new tab in the folder, which is also put on top of the recent projects. */
export async function openProject(folder: EnvPath): Promise<SessionInfo | undefined> {
  const info = await openShell(profileForFolder(folder), { cwd: folder });
  if (info) void rememberProject(folder);
  return info;
}

/** Asks for a folder and opens it as a project. */
export async function pickAndOpenProject(): Promise<void> {
  const picked = await api.app.pickFolder();
  if (picked) await openProject(picked as EnvPath);
}

/** A tab in `parent` that runs `git clone <url>` so the user sees the progress (and any error) themselves. */
export async function cloneRepository(url: string, parent: EnvPath): Promise<void> {
  const info = await openShell(profileForFolder(parent), { cwd: parent });
  if (!info) return;
  const command = `git clone ${url}`;
  for (let i = 0; i < 40; i++) {
    const r = await api.sessions.submit(info.id, command);
    if (r.ok) return;
    await new Promise((res) => setTimeout(res, 250));
  }
  useUi.getState().toast(tNow('editor.notReady'), 'error');
}
