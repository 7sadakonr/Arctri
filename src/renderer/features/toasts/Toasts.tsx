import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-14 right-4 z-50 flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'fade-in pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-xs shadow-lg',
            t.kind === 'error' ? 'border-danger/50 bg-panel text-danger' : 'border-border bg-panel text-fg'
          )}
          onClick={() => useUi.getState().dismissToast(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
