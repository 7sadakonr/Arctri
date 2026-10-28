import { FileText, X } from 'lucide-react';
import { Tip } from '@/components/ui/tooltip';
import { useT } from '@/lib/i18n';
import { useAttachments } from '@/stores/attachments';
import { peekHost } from '../terminal/xterm-host';
import { numberOf, type TrackedAttachment } from './attachment-tracker';

const NONE: TrackedAttachment[] = [];

function AttachmentChip({ sessionId, a }: { sessionId: string; a: TrackedAttachment }) {
  const t = useT();
  const hide = useAttachments((s) => s.remove);
  const n = numberOf(a);
  const label = n ? `#${n}` : a.name;
  return (
    <Tip
      label={
        a.thumb ? <img src={a.thumb} alt={label} className="max-h-60 max-w-[320px] rounded" /> : <span className="font-mono">{a.ref}</span>
      }
    >
      <span
        data-testid="attachment-chip"
        className={`inline-flex ${a.thumb ? 'h-8' : 'h-6'} max-w-[200px] shrink-0 items-center gap-1.5 rounded-md border border-border pl-1 pr-0.5 text-[11px] text-fg-muted`}
      >
        {a.thumb ? (
          <span className="relative shrink-0">
            <img src={a.thumb} alt="" className="h-7 w-7 rounded-sm object-cover" />
            {n && (
              <span className="absolute -left-1 -top-1 rounded bg-accent px-1 font-mono text-[9px] font-bold leading-3 text-white">{n}</span>
            )}
          </span>
        ) : (
          <FileText size={12} className="shrink-0" />
        )}
        <span data-testid="attachment-label" className={`truncate ${n ? 'font-mono font-semibold text-fg' : ''}`}>
          {label}
        </span>
        <button
          type="button"
          aria-label={t('agent.attachmentRemove', { label })}
          onClick={() => {
            hide(sessionId, a.id);
            void peekHost(sessionId)?.removeAttachment(a);
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-hover hover:text-fg"
        >
          <X size={10} />
        </button>
      </span>
    </Tip>
  );
}

/**
 * What is in the agent's message box right now, as small previews. The number is the one in `[Image #N]`, so it is clear which one
 * the × removes; the × takes the attachment out of the message too.
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
