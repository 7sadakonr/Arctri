import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { iconUrl } from '@/lib/file-icon';
import { useLang, useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useChanges } from '../agents/useChanges';
import { baseName, dirName } from './ChangesView';

type Commit = NonNullable<Awaited<ReturnType<typeof api.files.log>>>[number];
type CommitFile = NonNullable<Awaited<ReturnType<typeof api.files.commitFiles>>>[number];

const statusColor = (s: string) => (s === 'A' ? 'text-ok' : s === 'D' ? 'text-danger' : 'text-warn');

/** "3 h ago" in the interface language. */
export function relativeTime(sec: number, lang: 'en' | 'th', now = Date.now()): string {
  const diff = Math.max(0, Math.round(now / 1000 - sec));
  const unit = (n: number, en: string, th: string) => (lang === 'th' ? `${n} ${th}ที่แล้ว` : `${n} ${en} ago`);
  if (diff < 60) return lang === 'th' ? 'เมื่อสักครู่' : 'just now';
  if (diff < 3600) return unit(Math.floor(diff / 60), 'min', 'นาที');
  if (diff < 86400) return unit(Math.floor(diff / 3600), 'h', 'ชม.');
  if (diff < 86400 * 30) return unit(Math.floor(diff / 86400), 'd', 'วัน');
  return new Date(sec * 1000).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB');
}

/** The latest commits of the current branch. Opening one lists the files it changed; a file opens as a diff. */
export function HistoryView({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const lang = useLang();
  const [commits, setCommits] = useState<Commit[] | null | undefined>(undefined); // undefined: loading, null: not a repository
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [files, setFiles] = useState<Record<string, CommitFile[] | null>>({});
  const changes = useChanges(info.id, active);
  const signature = changes ? changes.files.map((f) => `${f.status}${f.path}`).join('\n') : '';

  const load = useCallback(async () => {
    try {
      setCommits(await api.files.log(info.id, 100));
    } catch {
      /* keep what is shown */
    }
  }, [info.id]);

  // a commit empties the list of changes and a switch moves the branch: both are reasons to read the log again
  useEffect(() => {
    void load();
  }, [load, info.gitBranch, info.cwd?.path, signature]);
  useEffect(() => {
    if (!active) return;
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [active, load]);

  const toggle = (hash: string) => {
    if (open === hash) return setOpen(undefined);
    setOpen(hash);
    if (!(hash in files)) {
      void api.files.commitFiles(info.id, hash).then((f) => setFiles((cur) => ({ ...cur, [hash]: f })), () => undefined);
    }
  };

  if (commits === undefined) return <div className="px-3 py-3 text-[12px] text-fg-muted">…</div>;
  if (commits === null) return <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.notGit')}</div>;
  if (commits.length === 0) return <div className="px-3 py-3 text-[12px] text-fg-muted">{t('sidebar.noCommits')}</div>;

  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      {commits.map((c) => {
        const isOpen = open === c.hash;
        const list = files[c.hash];
        return (
          <div key={c.hash} data-commit={c.short}>
            <button
              type="button"
              title={`${c.short} · ${c.author}`}
              onClick={() => toggle(c.hash)}
              className={cn('flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-hover', isOpen && 'bg-hover/60')}
            >
              {isOpen ? <ChevronDown size={12} className="mt-0.5 shrink-0" /> : <ChevronRight size={12} className="mt-0.5 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-fg">{c.subject}</span>
                <span className="flex items-center gap-1.5 text-[10px] text-fg-muted">
                  <span className="font-mono">{c.short}</span>
                  <span className="truncate">{c.author}</span>
                  <span className="shrink-0">{relativeTime(c.time, lang)}</span>
                  {c.refs.slice(0, 3).map((r) => (
                    <span key={r} className="shrink-0 rounded bg-accent/15 px-1 text-accent">
                      {r}
                    </span>
                  ))}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="pb-1">
                {list === undefined && <div className="px-8 py-1 text-[11px] text-fg-muted">…</div>}
                {list === null && <div className="px-8 py-1 text-[11px] text-fg-muted">{t('viewer.failed')}</div>}
                {list?.length === 0 && <div className="px-8 py-1 text-[11px] text-fg-muted">{t('sidebar.noFiles')}</div>}
                {list?.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    title={f.path}
                    onClick={() => useSessions.getState().openViewer(info.id, `${c.hash}:${f.path}`, 'diff', { path: f.path, rev: c.hash })}
                    className="flex w-full items-center gap-2 py-1 pl-8 pr-3 text-left text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
                  >
                    <img src={iconUrl(baseName(f.path), false)} alt="" width={14} height={14} draggable={false} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-fg">{baseName(f.path)}</span>
                      {dirName(f.path) && <span className="ml-1.5 text-[11px] opacity-70">{dirName(f.path)}</span>}
                    </span>
                    {(f.added > 0 || f.deleted > 0) && (
                      <span className="shrink-0 text-[10px]">
                        <span className="text-ok">+{f.added}</span> <span className="text-danger">−{f.deleted}</span>
                      </span>
                    )}
                    <span className={cn('w-4 shrink-0 text-center font-mono text-[11px]', statusColor(f.status))}>{f.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
