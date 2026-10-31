import { useEffect } from 'react';
import { useGitSyncStore } from '@/stores/git-sync';
import { refreshChanges } from '@/features/agents/useChanges';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { tNow } from '@/lib/i18n';
import { warnAgentStarted } from '@/features/launcher/preWork';
import { PreWorkCheckDialog } from '@/features/launcher/PreWorkCheckDialog';
import { useAgentStatus } from '@/stores/agent-status';
import { forgetNotified, notifyStatus } from '@/features/attention/notify';
import { defaultProfile, openShell, wasClosedHere } from '@/features/launcher/actions';
import { refreshAgents } from '@/features/launcher/NewTabMenu';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { TitleBar } from '@/features/titlebar/TitleBar';
import { HelpDialogs } from '@/features/titlebar/HelpDialogs';
import { CloneDialog } from '@/features/launcher/CloneDialog';
import { SessionSkeleton } from '@/features/terminal/SessionSkeleton';
import { Workspace } from '@/features/layout/Workspace';
import { SidebarDock } from '@/features/sidebar/SidebarDock';
import { useReportUnsaved } from '@/features/layout/useReportUnsaved';
import { useLayout } from '@/stores/layout';
import { allHosts, peekHost, screenText } from '@/features/terminal/xterm-host';
import { WelcomeScreen } from '@/features/welcome/WelcomeScreen';
import { isHomeFolder, pushRecent, toRecent } from '@/features/welcome/recent';
import { Toasts } from '@/features/toasts/Toasts';
import { UpdateDialog } from '@/features/update/UpdateDialog';
import { useUpdate } from '@/stores/update';
import { commandForKey, runCommand } from '@/commands/registry';
import { CommandPalette } from '@/features/palette/CommandPalette';

async function bootstrap(): Promise<void> {
  const ui = useUi.getState();
  const [prefs, profiles0, diag] = await Promise.all([api.prefs.get(), api.profiles.list(false), api.app.diagnostics()]);
  const profiles = profiles0;
  ui.setPrefs(prefs);
  ui.setProfiles(profiles.profiles, profiles.wsl, profiles.defaultProfileId);
  const build = Number(String(diag['os'] ?? '').split('.')[2]);
  if (Number.isFinite(build) && build > 0) ui.setWindowsBuild(build);
  if (diag['e2e']) {
    (window as unknown as Record<string, unknown>)['__arctriTest'] = {
      screen: (id?: string) => screenText(id ?? useSessions.getState().activeId ?? ''),
      activeId: () => useSessions.getState().activeId,
      sessions: () => Object.values(useSessions.getState().infos),
      layout: () => JSON.parse(JSON.stringify({ root: useLayout.getState().root, groups: useLayout.getState().groups, tabs: useLayout.getState().tabs, focused: useLayout.getState().focused, zoomed: useLayout.getState().zoomed }))
    };
  }

  // Sessions that outlived a page reload (development) come back first.
  const live = await api.sessions.list();
  for (const info of live) useSessions.getState().upsert(info);
  if (live.length > 0) return;

  // Tabs from the last run are not reopened: their folders go to the recent list on the welcome page instead.
  const savedTabs = await api.sessions.saved();
  let recent = prefs.recentProjects;
  for (const saved of [...savedTabs].reverse()) {
    if (saved.cwd && !isHomeFolder(saved.cwd.path)) recent = pushRecent(recent, toRecent(saved.cwd));
  }
  if (recent !== prefs.recentProjects) {
    try {
      useUi.getState().setPrefs(await api.prefs.set({ recentProjects: recent }));
    } catch {
      /* the list is a convenience */
    }
  }
  // The welcome page is shown instead of a terminal nobody asked for.
  // The e2e suite still starts with one tab (ARCTRI_E2E_WELCOME keeps the welcome page for its own test).
  if (diag['e2e'] && !diag['welcome'] && useSessions.getState().order.length === 0) {
    // The suite is written for PowerShell; it must not depend on which shell the machine's Windows Terminal starts.
    const ps = useUi.getState().profiles;
    await openShell(ps.find((p) => p.id === 'pwsh') ?? ps.find((p) => p.id === 'powershell') ?? defaultProfile());
  }
  void api.profiles.list(false, true).then((r) => useUi.getState().setProfiles(r.profiles, r.wsl, r.defaultProfileId));
  void refreshAgents(false);
}

export function App() {
  const order = useSessions((s) => s.order);
  const activeId = useSessions((s) => s.activeId);
  const booting = useSessions((s) => !s.booted || s.pendingOpen > 0);
  const prefs = useUi((s) => s.prefs);

  useEffect(() => {
    const offChanged = api.sessions.onChanged((info) => {
      if (wasClosedHere(info.id)) return;
      const startedAgent = !!info.runningAgent && !useSessions.getState().infos[info.id]?.runningAgent;
      useSessions.getState().upsert(info);
      if (startedAgent) void warnAgentStarted(info.id);
      const h = peekHost(info.id);
      if (h) {
        h.update(info);
        if (info.state === 'exited') h.tracker.closed();
      }
    });
    const offClosed = api.sessions.onClosed((id) => {
      forgetNotified(id);
      useSessions.getState().remove(id);
      useGitSyncStore.getState().forget(id);
    });
    const offFocus = api.sessions.onFocusRequested((id) => {
      if (useSessions.getState().infos[id]) useSessions.getState().setActive(id);
    });
    const offStatus = api.agentStatus.onChanged(({ id, status }) => {
      const prev = useAgentStatus.getState().byId[id];
      useAgentStatus.getState().set(id, status);
      if (status) notifyStatus(prev, status);
    });
    const offUpdate = api.update.onStatus((s) => useUpdate.getState().setStatus(s));
    void api.update.getStatus().then((s) => useUpdate.getState().setStatus(s), () => undefined);
    const offSync = api.gitSync.onChanged(({ sessionIds, snapshot }) => useGitSyncStore.getState().set(sessionIds, snapshot));
    const offRepo = api.gitSync.onRepoChanged(({ sessionIds, reason }) => {
      useGitSyncStore.getState().bump(sessionIds, reason === 'head' || reason === 'branch');
      for (const id of sessionIds) refreshChanges(id);
      if (reason === 'local' || reason === 'update' || reason === 'refs') return;
      // the branch or its commits moved outside Arctri: say so where it could matter, and touch nothing
      const snap = useGitSyncStore.getState().bySession[sessionIds[0] ?? ''];
      if (snap?.activeAgent || snap?.agentUnknown) useUi.getState().toast(tNow('sync.externalAgent'));
      else if (snap?.unsavedInArctri.length) useUi.getState().toast(tNow('sync.externalChange'));
    });
    void api.agentStatus.list().then((l) => useAgentStatus.getState().reset(l), () => undefined);
    // the main process marks the front tab's news as read, but only while this window is the one being looked at
    const reportActive = () => void api.agentStatus.active(useSessions.getState().activeId ?? null);
    window.addEventListener('focus', reportActive);
    void bootstrap().finally(() => useSessions.getState().setBooted());
    return () => {
      offStatus();
      offUpdate();
      offSync();
      offRepo();
      window.removeEventListener('focus', reportActive);
      offChanged();
      offClosed();
      offFocus();
    };
  }, []);

  useReportUnsaved();

  useEffect(() => {
    void api.agentStatus.active(activeId ?? null);
  }, [activeId]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset['theme'] = prefs.theme;
    root.style.setProperty('--ad-term-size', `${prefs.fontSize}px`);
    root.lang = navigator.language.startsWith('th') && prefs.language === 'auto' ? 'th' : prefs.language === 'th' ? 'th' : 'en';
    for (const h of allHosts()) h.applyPrefs(prefs.fontSize, prefs.theme === 'dark');
  }, [prefs.theme, prefs.fontSize, prefs.language]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // every app shortcut is a command in the registry: the menus and the palette run the same ones
      const c = commandForKey(e);
      if (!c) return;
      e.preventDefault();
      runCommand(c);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-bg pt-9 text-fg">
        <TitleBar />
        <main className="relative min-h-0 flex-1">
          {order.length > 0 ? (
            <div className="flex h-full min-h-0">
              <div className="min-w-0 flex-1">
                <Workspace />
              </div>
              <SidebarDock />
            </div>
          ) : booting ? (
            <SessionSkeleton />
          ) : (
            <WelcomeScreen />
          )}
        </main>
      </div>
      <SettingsDialog />
      <PreWorkCheckDialog />
      <CloneDialog />
      <HelpDialogs />
      <UpdateDialog />
      <CommandPalette />
      <Toasts />
    </TooltipProvider>
  );
}

