import { FileText, X } from 'lucide-react';
import { Tip } from '@/components/ui/tooltip';
import { useT } from '@/lib/i18n';
import { useAttachments } from '@/stores/attachments';
import type { TrackedAttachment } from './attachment-tracker';

const NONE: TrackedAttachment[] = [];

/** What is in the agent's message box right now, as small previews. Hiding one does not change the message. */
export function AttachmentChips({ sessionId }: { sessionId: string }) {
  const t = useT();
  const list = useAttachments((s) => s.bySession[sessionId]) ?? NONE;
  const hide = useAttachments((s) => s.remove);
  if (!list.length) return null;
  return (
    <>
      {list.map((a) => (
        <Tip
          key={a.id}
          label={
            a.thumb ? (
              <img src={a.thumb} alt={a.name} className="max-h-60 max-w-[320px] rounded" />
            ) : (
              <span className="font-mono">{a.ref}</span>
            )
          }
        >
          <span
            data-testid="attachment-chip"
            className="inline-flex h-6 max-w-[200px] shrink-0 items-center gap-1.5 rounded-md border border-border pl-1 pr-0.5 text-[11px] text-fg-muted"
          >
            {a.thumb ? (
              <img src={a.thumb} alt="" className="h-4 w-4 shrink-0 rounded-sm object-cover" />
            ) : (
              <FileText size={12} className="shrink-0" />
            )}
            <span className="truncate">{a.name}</span>
            <button
              type="button"
              aria-label={t('agent.attachmentHide')}
              onClick={() => hide(sessionId, a.id)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-hover hover:text-fg"
            >
              <X size={10} />
            </button>
          </span>
        </Tip>
      ))}
    </>
  );
}
