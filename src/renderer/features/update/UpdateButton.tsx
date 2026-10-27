import { ArrowUpCircle } from 'lucide-react';
import { Tip } from '@/components/ui/tooltip';
import { useT } from '@/lib/i18n';
import { useUpdate } from '@/stores/update';
import { updateSummary } from './summary';

/** Shown in the title bar only while an update is on offer, downloading or ready; it opens the update dialog. */
export function UpdateButton() {
  const t = useT();
  const status = useUpdate((s) => s.status);
  const kind = status?.phase.kind;
  if (kind !== 'available' && kind !== 'downloading' && kind !== 'downloaded') return null;
  return (
    <Tip label={updateSummary(t, status)} side="bottom">
      <button
        type="button"
        data-testid="update-button"
        className="no-drag flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-accent hover:bg-hover focus-visible:outline focus-visible:outline-accent"
        onClick={() => useUpdate.getState().openDialog(true)}
      >
        <ArrowUpCircle size={12} />
        <span>{t('update.button')}</span>
      </button>
    </Tip>
  );
}
