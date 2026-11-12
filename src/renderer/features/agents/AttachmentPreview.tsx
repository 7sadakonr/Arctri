import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { middleEllipsis } from './attachment-name';
import { numberOf, type TrackedAttachment } from './attachment-tracker';

/**
 * An attachment shown large. The small preview appears at once; the full picture replaces it when it has loaded.
 * Click the picture to switch between fitted and actual size.
 */
export function AttachmentPreview({ a, onClose }: { a: TrackedAttachment; onClose: () => void }) {
  const t = useT();
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!a.src);
  const [actual, setActual] = useState(false);
  const n = numberOf(a);

  useEffect(() => {
    if (!a.src) return;
    let dead = false;
    void api.files.attachmentImage(a.src).then(
      (url) => {
        if (dead) return;
        setFull(url);
        setLoading(false);
      },
      () => !dead && setLoading(false)
    );
    return () => {
      dead = true;
    };
  }, [a.src]);

  const src = full ?? a.thumb;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${n ? `#${n} · ` : ''}${middleEllipsis(a.name, 72)}`}
        closeLabel={t('common.close')}
        className="w-[min(1100px,94vw)]"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActiveSession();
        }}
      >
        <div data-testid="attachment-preview" className={`flex justify-center rounded-md bg-bg p-2 ${actual ? 'overflow-auto' : ''}`}>
          {src && (
            <img
              src={src}
              alt={a.name}
              onClick={() => setActual((v) => !v)}
              className={actual ? 'max-w-none cursor-zoom-out' : 'max-h-[70vh] max-w-full cursor-zoom-in object-contain'}
            />
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
          <span className="min-w-0 flex-1 truncate font-mono" title={a.ref}>
            {a.ref}
          </span>
          {loading && <span>{t('agent.attachmentLoading')}</span>}
          {a.src && (
            <Button variant="outline" onClick={() => void api.files.openAttachment(a.src!)}>
              {t('agent.attachmentOpen')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
