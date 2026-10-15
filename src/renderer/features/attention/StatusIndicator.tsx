import { CircleCheck, CircleHelp, CircleX, MessageCircle, ShieldAlert, type LucideIcon } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { TabStatus } from '@shared/agents/tab-status';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

type View =
  | { kind: 'ring'; tone: string; spin: 'ad-spin-12' | 'ad-spin-14'; gap: string }
  | { kind: 'dot'; tone: string; enter?: 'ad-enter-fade' }
  | { kind: 'icon'; Icon: LucideIcon; tone: string; enter?: 'ad-enter-fade' | 'ad-enter-pop' };

const VIEWS: Record<TabStatus, View> = {
  starting: { kind: 'ring', tone: 'text-fg-muted', spin: 'ad-spin-12', gap: '17 17.5' },
  running: { kind: 'ring', tone: 'text-sky-400', spin: 'ad-spin-14', gap: '17 17.5' },
  working: { kind: 'ring', tone: 'text-sky-400', spin: 'ad-spin-12', gap: '22 12.5' },
  ready: { kind: 'dot', tone: 'bg-ok', enter: 'ad-enter-fade' },
  exited: { kind: 'dot', tone: 'bg-fg-muted/60' },
  waiting: { kind: 'icon', Icon: MessageCircle, tone: 'text-amber-400', enter: 'ad-enter-pop' },
  approval: { kind: 'icon', Icon: ShieldAlert, tone: 'text-orange-400', enter: 'ad-enter-pop' },
  finished: { kind: 'icon', Icon: CircleCheck, tone: 'text-green-400', enter: 'ad-enter-pop' },
  error: { kind: 'icon', Icon: CircleX, tone: 'text-red-400', enter: 'ad-enter-fade' },
  unknown: { kind: 'icon', Icon: CircleHelp, tone: 'text-fg-muted' }
};

/**
 * One status mark in a fixed 14x14 box, so a change never moves what is next to it.
 * - Spinners rotate with CSS only; the element stays the same between re-renders, so the rotation never restarts.
 * - The other states play one short entrance (opacity / scale) when the status changes, and none the first time they are drawn
 *   (a reloaded window shows the current state, not news).
 * - With reduced motion nothing moves at all (see globals.css).
 */
export const StatusIndicator = memo(function StatusIndicator({ status, unread, size = 14 }: { status: TabStatus; unread?: boolean; size?: number }) {
  const t = useT();
  const prev = useRef<TabStatus | undefined>(undefined);
  const changed = prev.current !== undefined && prev.current !== status;
  useEffect(() => {
    prev.current = status;
  }, [status]);

  const v = VIEWS[status];
  const px = Math.round(size);
  let mark: React.ReactNode;
  if (v.kind === 'ring') {
    mark = (
      <svg key={status} viewBox="0 0 14 14" width={px} height={px} className={cn(v.tone, v.spin)} aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={v.gap} />
      </svg>
    );
  } else if (v.kind === 'dot') {
    mark = <span key={status} className={cn('block h-[7px] w-[7px] rounded-full', v.tone, changed && v.enter)} aria-hidden="true" />;
  } else {
    const Icon = v.Icon;
    mark = (
      <span key={status} className={cn('inline-flex', v.tone, changed && v.enter)} aria-hidden="true">
        <Icon size={px} strokeWidth={2} />
      </span>
    );
  }
  return (
    <span
      data-status={status}
      data-unread={unread ? 'true' : undefined}
      role="img"
      aria-label={t(`agent.state.${status}` as MessageKey)}
      style={{ width: 14, height: 14 }}
      className="relative inline-flex shrink-0 items-center justify-center"
    >
      {mark}
      {unread && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-1 ring-panel" />}
    </span>
  );
});
