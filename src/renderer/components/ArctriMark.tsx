import { cn } from '@/lib/cn';

/** Arctri's own mark (the "A" with its dash), drawn in the surrounding text colour. */
export function ArctriMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 320 289" width={size} height={(size * 289) / 320} aria-hidden="true" className={cn('shrink-0', className)}>
      <path
        fill="currentColor"
        d="M160.007 0C175.032 0 188.912 8.02623 196.407 21.0479L314.407 226.048C325.979 246.151 319.062 271.829 298.959 283.4C278.856 294.972 253.178 288.056 241.606 267.952L160.007 126.189L78.4072 267.952C66.8355 288.056 41.1581 294.972 21.0547 283.4C0.951332 271.829 -5.96512 246.151 5.60645 226.048L123.606 21.0479L123.962 20.4404C131.535 7.77672 145.217 0 160.007 0Z"
      />
      <rect fill="currentColor" x="112" y="227" width="96" height="40" rx="20" />
    </svg>
  );
}
