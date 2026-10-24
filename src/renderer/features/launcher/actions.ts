import type { EnvPath, ShellProfile } from '@shared/types/env';
import type { AgentId, AgentLaunchOptions, SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { tNow } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { disposeHost } from '../terminal/xterm-host';
import { useBlocks } from '@/stores/blocks';
import { pushRecent, toRecent } from '../welcome/recent';
import { confirmPreWork } from './preWork';

const INITIAL = { cols: 120, rows: 30 };

/** The shell the user asked for: the one chosen in Settings, otherwise Windows Terminal's default. */
function wantedDefaultId(): string | undefined {
  const { profiles, prefs, windowsDefaultProfile } = useUi.getState();
  return prefs.defaultProfile && profiles.some((p) => p.id === prefs.defaultProfile) ? prefs.defaultProfile : windowsDefaultProfile;
}

/** Only shells that can show command blocks are offered; Command Prompt, Git Bash and the like are left out. */
export const blockProfiles = (profiles: ShellProfile[]): ShellProfile[] => profiles.filter((p) => p.integration === 'blocks');

export function defaultProfile(): ShellProfile | undefined {
  const profiles = blockProfiles(useUi.getState().profiles);
  const want = wantedDefaultId()?.toLowerCase();
  return profiles.find((p) => p.id.toLowerCase() === want) ?? profiles[0];
}

/**
 * Like `defaultProfile`, but when the default is a WSL distribution that is not known yet it makes WSL answer
 * (asking again once), so a project or a new tab never silently lands in another shell.
 */
export async function resolveDefaultProfile(): Promise<ShellProfile | undefined> {
  const want = wantedDefaultId();
  const missing = () => !!want && !useUi.getState().profiles.some((p) => p.id.toLowerCase() === want.toLowerCase());
  for (let attempt = 0; attempt < 2 && missing(); attempt++) {
    try {
      const r = await api.profiles.list(true, true);
      useUi.getState().setProfiles(r.profiles, r.wsl, r.defaultProfileId);
    } catch {
      /* fall back to what is known */
    }
    if (missing() && attempt === 0) await new Promise((res) => setTimeout(res, 1500));
  }
  const found = defaultProfile();
  if (want && missing() && found) useUi.getState().toast(tNow('launcher.defaultMissing', { want: want.replace(/^wsl(app)?:/, ''), used: found.label }), 'error');
  return found;
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export async function openShell(
  profile: ShellProfile | undefined,
  opts: { cwd?: EnvPath; title?: string } = {}
): Promise<SessionInfo | undefined> {
  if (!profile) return undefined;
  useSessions.getState().addPending(1);
  try {
    const info = await api.sessions.create({
      profileId: profile.id,
      kind: 'shell',
      ...INITIAL,
      presentation: 'blocks',
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.title ? { title: opts.title } : {})
    });
    useSessions.getState().upsert(info, true);
    if (info.launchNote === 'cwd-unmapped') useUi.getState().toast(tNow('session.cwdFallback'));
    return info;
  } catch (e) {
    useUi.getState().toast(tNow('session.failed', { reason: errText(e) }), 'error');
    return undefined;
  } finally {
    useSessions.getState().addPending(-1);
  }
}

/** A new tab for the shell the user is currently in, starting where that shell starts (not in the folder the tab has moved to). */
export async function openSimilarTab(): Promise<void> {
  const { activeId, infos } = useSessions.getState();
  const cur = activeId ? infos[activeId] : undefined;
  const profile = cur && cur.kind === 'shell' ? useUi.getState().profiles.find((p) => p.id === cur.profileId) : undefined;
  await openShell(profile ?? (await resolveDefaultProfile()));
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
  // Arctri's own buttons look at the repository first (a typed `claude` is never intercepted); the user decides
  if (cwd && !(await confirmPreWork(cwd))) return undefined;
  useSessions.getState().addPending(1);
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
  } finally {
    useSessions.getState().addPending(-1);
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

/** Starts the same shell or agent again in the same folder, leaving the given tab open. */
export async function duplicateSession(info: SessionInfo): Promise<SessionInfo | undefined> {
  const cwd = info.cwd;
  if (info.kind === 'agent') {
    const l = agentLaunchOf(info.id);
    return l ? openAgent(l.adapterId, l.profileId, l.displayName, l.options, cwd) : undefined;
  }
  const profile = useUi.getState().profiles.find((p) => p.id === info.profileId);
  return openShell(profile, cwd ? { cwd } : {});
}

/** Starts the same shell or agent again in the same folder and closes the ended tab. */
export async function restartSession(info: SessionInfo): Promise<void> {
  if (await duplicateSession(info)) await closeSession(info.id);
}

/** Closes the tabs picked by `pick` from the current order; pinned tabs are kept, as with the middle button. */
function closeWhere(pick: (order: string[]) => string[]): void {
  const { order, pinned } = useSessions.getState();
  for (const id of pick(order)) if (!pinned[id]) void closeSession(id);
}

export const closeOtherSessions = (keep: string): void => closeWhere((order) => order.filter((x) => x !== keep));
export const closeSessionsToRight = (from: string): void => closeWhere((order) => order.slice(order.indexOf(from) + 1));

/** A plain shell in the environment and folder of the given session. */
export async function openShellHere(info: SessionInfo): Promise<void> {
  const { profiles } = useUi.getState();
  const fallback = info.env.kind === 'wsl' ? undefined : await resolveDefaultProfile();
  const profile =
    info.env.kind === 'wsl'
      ? profiles.find((p) => p.env.kind === 'wsl' && p.env.distro === (info.env as { distro: string }).distro) ??
        profiles.find((p) => p.env.kind === 'wsl')
      : fallback;
  await openShell(profile, info.cwd ? { cwd: info.cwd } : {});
}

/** The profile to use for a folder: a WSL folder gets a shell of its own distribution, anything else the default. */
async function profileForFolder(folder: EnvPath): Promise<ShellProfile | undefined> {
  if (folder.env !== 'wsl') return resolveDefaultProfile();
  const mineIn = (list: ShellProfile[]) =>
    list.filter((p) => p.env.kind === 'wsl' && p.env.distro.toLowerCase() === folder.distro.toLowerCase());
  if (mineIn(useUi.getState().profiles).length === 0) {
    // WSL has not been asked about yet (or did not answer): make it answer before settling for another shell.
    try {
      const r = await api.profiles.list(true, true);
      useUi.getState().setProfiles(r.profiles, r.wsl, r.defaultProfileId);
    } catch {
      /* fall back to what is known */
    }
  }
  const { profiles } = useUi.getState();
  return mineIn(profiles)[0] ?? profiles.find((p) => p.env.kind === 'wsl') ?? (await resolveDefaultProfile());
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
  const info = await openShell(await profileForFolder(folder), { cwd: folder });
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
  const info = await openShell(await profileForFolder(parent), { cwd: parent });
  if (!info) return;
  const command = `git clone ${url}`;
  for (let i = 0; i < 40; i++) {
    const r = await api.sessions.submit(info.id, command);
    if (r.ok) return;
    await new Promise((res) => setTimeout(res, 250));
  }
  useUi.getState().toast(tNow('editor.notReady'), 'error');
}
