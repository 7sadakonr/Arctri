import { FolderOpen, GitFork, Plus, TerminalSquare, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import { cloneRepository, defaultProfile, openProject, openShell, pickAndOpenProject } from '../launcher/actions';
import { projectName, removeRecent, toEnvPath, type RecentProject } from './recent';
import type { EnvPath } from '@shared/types/env';

const RECENT_SHOWN = 5;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
        <span>{title}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function Row({ icon, label, hint, detail, onClick, onRemove, removeLabel }: {
  icon: ReactNode; label: string; hint?: string; detail?: string; onClick: () => void; onRemove?: () => void; removeLabel?: string;
}) {
  return (
    <div className="group flex items-center rounded-md hover:bg-hover">
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left text-[13px] text-fg">
        <span className="shrink-0 text-fg-muted">{icon}</span>
        <span className="shrink-0">{label}</span>
        {detail && <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted" title={detail}>{detail}</span>}
        {!detail && <span className="flex-1" />}
        {hint && <span className="shrink-0 text-[11px] text-fg-muted">{hint}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="mr-1 rounded p-1 text-fg-muted opacity-0 hover:text-fg group-hover:opacity-100 focus:opacity-100"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

const SAFE_URL = /^[\w.@:/~+%=?#-]+$/;

function CloneDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const valid = SAFE_URL.test(url.trim());
  const submit = async () => {
    if (!valid) return;
    const parent = await api.app.pickFolder();
    if (!parent) return;
    onOpenChange(false);
    setUrl('');
    await cloneRepository(url.trim(), parent as EnvPath);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('welcome.cloneTitle')} closeLabel={t('welcome.cloneCancel')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('welcome.cloneUrl')}
            spellCheck={false}
            className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-[12px] text-fg outline-none focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('welcome.cloneCancel')}
            </Button>
            <Button type="submit" variant="outline" disabled={!valid}>
              {t('welcome.cloneStart')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The page shown while no tab is open: start something new, or go back to a recent folder. */
export function WelcomeScreen() {
  const t = useT();
  const recent = useUi((s) => s.prefs.recentProjects);
  const shown = recent.slice(0, RECENT_SHOWN);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    let chordAt = 0;
    const h = (e: KeyboardEvent) => {
      if (cloning) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && !e.altKey && k === 'k') {
        chordAt = Date.now();
        e.preventDefault();
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && k === 'o' && Date.now() - chordAt < 1500) {
        chordAt = 0;
        e.preventDefault();
        void pickAndOpenProject();
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-5]$/.test(e.key)) {
        const r = shown[Number(e.key) - 1];
        if (r) {
          e.preventDefault();
          void openProject(toEnvPath(r));
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [shown, cloning]);

  const forget = (r: RecentProject) =>
    void api.prefs.set({ recentProjects: removeRecent(recent, r) }).then((p) => useUi.getState().setPrefs(p), () => undefined);

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8">
      <div className="w-[min(520px,100%)]">
        <Section title={t('welcome.getStarted')}>
          <Row icon={<Plus size={14} />} label={t('welcome.newTerminal')} hint="Ctrl+Shift+T" onClick={() => void openShell(defaultProfile())} />
          <Row icon={<FolderOpen size={14} />} label={t('welcome.openProject')} hint="Ctrl+K Ctrl+O" onClick={() => void pickAndOpenProject()} />
          <Row icon={<GitFork size={14} />} label={t('welcome.cloneRepo')} onClick={() => setCloning(true)} />
        </Section>
        <Section title={t('welcome.recent')}>
          {shown.length === 0 && <div className="px-2 py-1.5 text-[12px] text-fg-muted">{t('welcome.noRecent')}</div>}
          {shown.map((r, i) => (
            <Row
              key={`${r.env}:${r.distro ?? ''}:${r.path}`}
              icon={<TerminalSquare size={14} />}
              label={projectName(r.path)}
              detail={r.env === 'wsl' ? `${r.distro}: ${r.path}` : r.path}
              hint={`Ctrl+${i + 1}`}
              onClick={() => void openProject(toEnvPath(r))}
              onRemove={() => forget(r)}
              removeLabel={t('welcome.removeRecent')}
            />
          ))}
        </Section>
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} />
    </div>
  );
}
