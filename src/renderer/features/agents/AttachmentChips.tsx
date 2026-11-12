import { FileText, X } from 'lucide-react';
import { useState } from 'react';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { tNow, useT } from '@/lib/i18n';
import { useAttachments } from '@/stores/attachments';
import { useUi } from '@/stores/ui';
import { peekHost } from '../terminal/xterm-host';
import { AttachmentPreview } from './AttachmentPreview';
import { middleEllipsis } from './attachment-name';
import { numberOf, type TrackedAttachment } from './attachment-tracker';

const NONE: TrackedAttachment[] = [];

/**
 * Takes the chip away at once and the attachment out of the message. If the message cannot be changed safely, the chip comes
 * back where it was, so it never looks removed while its text is still there.
 */
function removeChip(sessionId: string, a: TrackedAttachment): void {
  const store = useAttachments.getState();
  const before = store.bySession[sessionId] ?? [];
  const index = before.findIndex((x) => x.id === a.id);
  // the same file attached twice is in the message twice: this chip is the n-th of them (they are stored in message order)
  const occurrence = before.slice(0, Math.max(0, index)).filter((x) => x.ref === a.ref).length;
  store.remove(sessionId, a.id);
  const host = peekHost(sessionId);
  if (!host) return;
  void host.removeAttachment(a, occurrence).then((ok) => {
    if (ok) return;
    const now = useAttachments.getState().bySession[sessionId] ?? [];
    if (now.some((x) => x.id === a.id)) return;
    const at = Math.min(Math.max(0, index), now.length);
    useAttachments.getState().set(sessionId, [...now.slice(0, at), a, ...now.slice(at)]);
    useUi.getState().toast(tNow('agent.attachmentRemoveFailed'));
  });
}

function AttachmentChip({ sessionId, a }: { sessionId: string; a: TrackedAttachment }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const n = numberOf(a);
  const label = n ? `#${n}` : middleEllipsis(a.name, 28);
  // an image can be shown large; any other file is opened in its own app. Without either there is nothing to click.
  const canPreview = !!a.thumb;
  const canOpen = !canPreview && !!a.src;
  const clickable = canPreview || canOpen;
  const hint = canPreview ? t('agent.attachmentPreview') : canOpen ? t('agent.attachmentOpenHint') : undefined;

  const activate = () => {
    if (canPreview) setOpen(true);
    else if (canOpen) void api.files.openAttachment(a.src!);
  };

  return (
    <>
      <Tip
        label={
          <span className="flex flex-col gap-1">
            {a.thumb && <img src={a.thumb} alt={a.name} className="max-h-60 max-w-[320px] rounded" />}
            <span className="break-all font-mono">{a.thumb ? a.name : a.ref}</span>
            {hint && <span className="text-[10px] opacity-70">{hint}</span>}
          </span>
        }
      >
        <span
          data-testid="attachment-chip"
          className={`inline-flex h-8 max-w-[240px] shrink-0 items-center rounded-md border border-border pr-0.5 text-xs text-fg-muted`}
        >
          <button
            type="button"
            data-testid="attachment-open"
            disabled={!clickable}
            aria-label={hint ? `${label} · ${hint}` : label}
            onClick={activate}
            className={`flex h-full min-w-0 items-center gap-1.5 rounded-l-md pl-1 pr-1 ${clickable ? 'cursor-pointer hover:bg-hover hover:text-fg' : 'cursor-default'}`}
          >
            {a.thumb ? (
              <span className="relative shrink-0">
                <img src={a.thumb} alt="" className="h-6 w-6 rounded-sm object-cover" />
                {n && (
                  <span className="absolute -left-1 -top-1 rounded bg-accent px-1 font-mono text-[9px] font-bold leading-3 text-white">{n}</span>
                )}
              </span>
            ) : (
              <FileText size={14} className="shrink-0" />
            )}
            <span data-testid="attachment-label" className={`max-w-[180px] truncate ${n ? 'font-mono font-semibold text-fg' : ''}`}>
              {label}
            </span>
          </button>
          <button
            type="button"
            aria-label={t('agent.attachmentRemove', { label })}
            onClick={() => removeChip(sessionId, a)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-hover hover:text-fg"
          >
            <X size={12} />
          </button>
        </span>
      </Tip>
      {open && <AttachmentPreview a={a} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * What is in the agent's message box right now, as small previews. The number is the one in `[Image #N]`, so it is clear which one
 * the × removes; the × takes the attachment out of the message too. Clicking an image shows it large.
 */
export function AttachmentChips({ sessionId }: { sessionId: string }) {
  const stored = useAttachments((s) => s.bySession[sessionId]) ?? NONE;
  // numbered ones first, in the order of their numbers (the order of the placeholders in the message)
  const list = [...stored].sort((a, b) => (numberOf(a) ?? Infinity) - (numberOf(b) ?? Infinity));
  return (
    <>
      {list.map((a) => (
        <AttachmentChip key={a.id} sessionId={sessionId} a={a} />
      ))}
    </>
  );
}
