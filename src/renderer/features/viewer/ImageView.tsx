import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif'
};
const extOf = (rel: string) => rel.split('.').at(-1)?.toLowerCase() ?? '';

export const isImage = (rel: string) => extOf(rel) in MIME;

type Img = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; src: string; size: number; mtimeMs: number };

/** A picture shown fitted to the panel; click toggles between fitted and actual size. It follows the file on disk. */
export function ImageView({ sessionId, rel, active }: { sessionId: string; rel: string; active: boolean }) {
  const t = useT();
  const [img, setImg] = useState<Img>({ state: 'loading' });
  const [dims, setDims] = useState<{ w: number; h: number } | undefined>();
  const [actual, setActual] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let dead = false;
    void api.files.readImage(sessionId, rel).then((r) => {
      if (dead) return;
      if (!r.ok) return setImg({ state: 'error', error: r.error });
      setImg({ state: 'ready', src: `data:${MIME[extOf(rel)]};base64,${r.base64}`, size: r.size, mtimeMs: r.mtimeMs });
    }, () => !dead && setImg({ state: 'error', error: 'failed' }));
    return () => {
      dead = true;
    };
  }, [sessionId, rel, nonce]);

  const mtime = img.state === 'ready' ? img.mtimeMs : 0;
  useEffect(() => {
    if (!active || img.state !== 'ready') return;
    const i = setInterval(() => {
      void api.files.stat(sessionId, rel).then((s) => s && s.mtimeMs !== mtime && setNonce((n) => n + 1), () => undefined);
    }, 1500);
    return () => clearInterval(i);
  }, [sessionId, rel, active, img.state, mtime]);

  if (img.state === 'loading') return <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{t('viewer.loading')}</div>;
  if (img.state === 'error') {
    const key = img.error === 'too-large' ? 'viewer.tooLarge' : img.error === 'not-found' ? 'viewer.notFound' : 'viewer.failed';
    return <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">{t(key)}</div>;
  }
  return (
    <div className="absolute inset-0 flex flex-col bg-bg">
      <div
        data-testid="image-view"
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
        style={{ backgroundImage: 'conic-gradient(var(--ad-hover) 25%, transparent 0 50%, var(--ad-hover) 0 75%, transparent 0)', backgroundSize: '16px 16px' }}
      >
        <img
          src={img.src}
          alt={rel}
          draggable={false}
          onClick={() => setActual((v) => !v)}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className={actual ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}
        />
      </div>
      <div className="shrink-0 border-t border-border bg-panel px-3 py-1 text-[11px] text-fg-muted">
        {dims ? `${dims.w} × ${dims.h} · ` : ''}{img.size < 1024 ? `${img.size} B` : `${Math.round(img.size / 1024)} KB`}
      </div>
    </div>
  );
}
