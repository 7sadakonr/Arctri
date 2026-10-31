import { cn } from '@/lib/cn';

/** Terminal glyph: a soft, rounded tile with a bold prompt chevron and cursor dash, all in the text colour. */
export function TerminalIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" className={cn('shrink-0', className)}>
      <rect x="1" y="1.5" width="14" height="13" rx="4.5" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.4" />
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.9 6.2 7.3 8.4 4.9 10.6" />
        <path d="M8.9 10.7H11.3" />
      </g>
    </svg>
  );
}
