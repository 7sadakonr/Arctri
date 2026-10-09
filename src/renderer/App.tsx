import { Plus } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { closeSession, defaultProfile, openShell, openSimilarTab } from '@/features/launcher/actions';
import { refreshAgents } from '@/features/launcher/NewTabMenu';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { TabBar } from '@/features/tabs/TabBar';
import { SessionView } from '@/features/terminal/SessionView';
import { allHosts, peekHost, screenText } from '@/features/terminal/xterm-host';
import { Toasts } from '@/features/toasts/Toasts';

async function bootstrap(): Promise<void> {
  const ui = useUi.getState();
  const [prefs, profiles0, diag] = await Promise.all([api.prefs.get(), api.profiles.list(false), api.app.diagnostics()]);
  let profiles = profiles0;
  ui.setPrefs(prefs);
  ui.setProfiles(profiles.profiles, profiles.wsl);
  const build = Number(String(diag['os'] ?? '').split('.')[2]);
  if (Number.isFinite(build) && build > 0) ui.setWindowsBuild(build);
  if (diag['e2e']) {
    (window as unknown as Record<string, unknown>)['__agentdockTest'] = {
      screen: (id?: string) => screenText(id ?? useSessions.getState().activeId ?? ''),
      activeId: () => useSessions.getState().activeId,
      sessions: () => Object.values(useSessions.getState().infos)
    };
  }

  // Sessions that outlived a page reload (development) come back first.
  const live = await api.sessions.list();
  for (const info of live) useSessions.getState().upsert(info);
  if (live.length > 0) return;

  if (prefs.restoreTabs) {
    const savedTabs = await api.sessions.saved();
    // WSL is probed in the background; wait for it only when a saved tab needs it.
    if (savedTabs.some((x) => x.profileId.startsWith('wsl:'))) {
      profiles = await api.profiles.list(false, true);
      ui.setProfiles(profiles.profiles, profiles.wsl);
    }
    for (const saved of savedTabs) {
      const profile = useUi.getState().profiles.find((p) => p.id === saved.profileId);
      if (profile) await openShell(profile, { ...(saved.cwd ? { cwd: saved.cwd } : {}), ...(saved.titleSource === 'user' ? { title: saved.title } : {}) });
    }
  }
  if (useSessions.getState().order.length === 0) {
    if (prefs.defaultProfile?.startsWith('wsl:')) {
      const r = await api.profiles.list(false, true);
      ui.setProfiles(r.profiles, r.wsl);
    }
    await openShell(defaultProfile());
  }
  void api.profiles.list(false, true).then((r) => useUi.getState().setProfiles(r.profiles, r.wsl));
  void refreshAgents(false);
}

export function App() {
  const t = useT();
  const order = useSessions((s) => s.order);
  const infos = useSessions((s) => s.infos);
  const activeId = useSessions((s) => s.activeId);
  const prefs = useUi((s) => s.prefs);

  useEffect(() => {
    const offChanged = api.sessions.onChanged((info) => {
      useSessions.getState().upsert(info);
      const h = peekHost(info.id);
      if (h) {
        h.update(info);
        if (info.state === 'exited') h.tracker.closed();
      }
    });
    const offClosed = api.sessions.onClosed((id) => useSessions.getState().remove(id));
    void bootstrap();
    return () => {
      offChanged();
      offClosed();
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
      if (e.ctrlKey && e.shiftKey && k === 't') {
        e.preventDefault();
        void openSimilarTab();
      } else if (e.ctrlKey && e.shiftKey && k === 'w') {
        e.preventDefault();
        if (s.activeId) void closeSession(s.activeId);
      } else if (e.ctrlKey && k === 'tab') {
        e.preventDefault();
        if (s.order.length > 1 && s.activeId) {
          const i = s.order.indexOf(s.activeId);
          const next = (i + (e.shiftKey ? -1 : 1) + s.order.length) % s.order.length;
          s.setActive(s.order[next]!);
        }
      } else if (e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const id = s.order[Number(e.key) - 1];
        if (id) {
          e.preventDefault();
          s.setActive(id);
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        window.dispatchEvent(new Event('agentdock:rename-tab'));
      } else if (e.ctrlKey && k === ',') {
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
        <TabBar />
        <main className="relative min-h-0 flex-1">
          {order.map((id) => {
            const info = infos[id];
            return info ? <SessionView key={id} info={info} active={id === activeId} /> : null;
          })}
          {order.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-muted">
              <div className="text-sm">{t('tab.noSessions')}</div>
              <Button variant="outline" onClick={() => void openShell(defaultProfile())}>
                <Plus size={13} />
                {t('tab.new')}
              </Button>
            </div>
          )}
        </main>
      </div>
      <SettingsDialog />
      <Toasts />
    </TooltipProvider>
  );
}

