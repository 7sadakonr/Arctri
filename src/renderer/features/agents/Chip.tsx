import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/** The small bordered control used all over the agent bar. */
export const Chip = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tone?: 'default' | 'good' }>(
  ({ className, active, tone = 'default', ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40',
        tone === 'good'
          ? 'border-ok/40 bg-ok/10 text-ok hover:bg-ok/20'
          : active
            ? 'border-accent/50 bg-hover text-fg'
            : 'border-border text-fg-muted hover:bg-hover hover:text-fg',
        className
      )}
      {...props}
    />
  )
);
Chip.displayName = 'Chip';
