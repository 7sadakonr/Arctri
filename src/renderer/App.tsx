import { useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { useSessions } from '@/stores/sessions';
import { isMac, modKey } from '@/lib/platform';
import { useUi } from '@/stores/ui';
import { closeSession, defaultProfile, openShell, openSimilarTab, wasClosedHere } from '@/features/launcher/actions';
import { refreshAgents } from '@/features/launcher/NewTabMenu';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { TabBar } from '@/features/tabs/TabBar';
import { TitleBar } from '@/features/titlebar/TitleBar';
import { HelpDialogs } from '@/features/titlebar/HelpDialogs';
import { CloneDialog } from '@/features/launcher/CloneDialog';
import { stepZoom } from '@/lib/zoom';
import { toggleSidebar } from '@/features/sidebar/toggle';
import { SessionView } from '@/features/terminal/SessionView';
import { allHosts, peekHost, screenText } from '@/features/terminal/xterm-host';
import { WelcomeScreen } from '@/features/welcome/WelcomeScreen';
import { isHomeFolder, pushRecent, toRecent } from '@/features/welcome/recent';
import { Toasts } from '@/features/toasts/Toasts';
import { TOGGLE_RICH_EVENT } from '@/features/agents/AgentBar';

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
      sessions: () => Object.values(useSessions.getState().infos)
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
  const infos = useSessions((s) => s.infos);
  const activeId = useSessions((s) => s.activeId);
  const prefs = useUi((s) => s.prefs);

  useEffect(() => {
    const offChanged = api.sessions.onChanged((info) => {
      if (wasClosedHere(info.id)) return;
      useSessions.getState().upsert(info);
      const h = peekHost(info.id);
      if (h) {
        h.update(info);
        if (info.state === 'exited') h.tracker.closed();
      }
    });
    const offClosed = api.sessions.onClosed((id) => useSessions.getState().remove(id));
    const offFocus = api.sessions.onFocusRequested((id) => {
      if (useSessions.getState().infos[id]) useSessions.getState().setActive(id);
    });
    void bootstrap();
    return () => {
      offChanged();
      offClosed();
      offFocus();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset['theme'] = prefs.theme;
    root.style.setProperty('--ad-term-size', `${prefs.fontSize}px`);
    root.lang = navigator.language.startsWith('th') && prefs.language === 'auto' ? 'th' : prefs.language === 'th' ? 'th' : 'en';
    for (const h of allHosts()) h.applyPrefs(prefs.fontSize, prefs.theme === 'dark');
  }, [prefs.theme, prefs.fontSize, prefs.language]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const s = useSessions.getState();
      const mod = modKey(e);
      // Cmd+T / Cmd+W on a Mac, Ctrl+Shift+T / Ctrl+Shift+W elsewhere (the shell uses Ctrl+W and Ctrl+T itself)
      const tabChord = mod && (isMac ? !e.shiftKey : e.shiftKey);
      if (tabChord && k === 't') {
        e.preventDefault();
        void openSimilarTab();
      } else if (tabChord && k === 'w') {
        e.preventDefault();
        if (s.activeId) void closeSession(s.activeId);
      } else if (e.ctrlKey && k === 'tab') {
        e.preventDefault();
        if (s.order.length > 1 && s.activeId) {
          const i = s.order.indexOf(s.activeId);
          const next = (i + (e.shiftKey ? -1 : 1) + s.order.length) % s.order.length;
          s.setActive(s.order[next]!);
        }
      } else if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const id = s.order[Number(e.key) - 1];
        if (id) {
          e.preventDefault();
          s.setActive(id);
        }
      } else if (mod && e.shiftKey && k === 'e') {
        e.preventDefault();
        toggleSidebar();
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && k === 'g') {
        const info = s.activeId ? s.infos[s.activeId] : undefined;
        if (info && (info.kind === 'agent' || info.runningAgent)) {
          e.preventDefault();
          window.dispatchEvent(new Event(TOGGLE_RICH_EVENT));
        }
      } else if (mod && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        void stepZoom(e.key === '-' ? -1 : e.key === '0' ? 0 : 1);
      } else if (e.key === 'F2') {
        e.preventDefault();
        window.dispatchEvent(new Event('arctri:rename-tab'));
      } else if (mod && k === ',') {
        e.preventDefault();
        useUi.getState().openSettings(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-bg pt-9 text-fg">
        <TitleBar />
        <TabBar />
        <main className="relative min-h-0 flex-1">
          {order.map((id) => {
            const info = infos[id];
            return info ? <SessionView key={id} info={info} active={id === activeId} /> : null;
          })}
          {order.length === 0 && <WelcomeScreen />}
        </main>
      </div>
      <SettingsDialog />
      <CloneDialog />
      <HelpDialogs />
      <Toasts />
    </TooltipProvider>
  );
}

