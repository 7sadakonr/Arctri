import { cn } from '@/lib/cn';

const OUTPUT_LINES = ['w-2/5', 'w-3/5', 'w-1/3', 'w-1/2'];

/** The shape of a block-mode terminal (output area, command box, bottom bar) while there is nothing to draw yet. */
export function SessionSkeleton({ label, className, testId }: { label?: string; className?: string; testId?: string }) {
  return (
    <div data-testid={testId} aria-busy="true" className={cn('flex flex-col bg-bg', !className && 'h-full', className)}>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pt-4 motion-safe:animate-pulse">
        {OUTPUT_LINES.map((w) => (
          <div key={w} className={cn('h-3 rounded bg-fg-muted/15', w)} />
        ))}
        {label && <span className="pt-2 text-[12px] text-fg-muted">{label}</span>}
      </div>
      <div className="px-3 pt-2">
        <div className="h-[38px] rounded-lg border border-border bg-panel" />
      </div>
      <div className="flex min-h-7 items-center gap-3 px-3 py-0.5 motion-safe:animate-pulse">
        <div className="h-2.5 w-24 rounded bg-fg-muted/15" />
        <div className="h-2.5 w-16 rounded bg-fg-muted/15" />
      </div>
    </div>
  );
}
