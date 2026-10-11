import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useUi } from '@/stores/ui';
import type { EnvPath } from '@shared/types/env';
import { cloneRepository } from './actions';

const SAFE_URL = /^[\w.@:/~+%=?#-]+$/;

export function CloneDialog() {
  const t = useT();
  const open = useUi((s) => s.cloneOpen);
  const onOpenChange = useUi.getState().setCloneOpen;
  const [url, setUrl] = useState('');
  const valid = SAFE_URL.test(url.trim());
  const submit = async () => {
    if (!valid) return;
    const parent = await api.app.pickFolder();
    if (!parent) return;
    onOpenChange(false);
    setUrl('');
    await cloneRepository(url.trim(), parent as EnvPath);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('welcome.cloneTitle')} closeLabel={t('welcome.cloneCancel')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('welcome.cloneUrl')}
            spellCheck={false}
            className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-[12px] text-fg outline-none focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('welcome.cloneCancel')}
            </Button>
            <Button type="submit" variant="outline" disabled={!valid}>
              {t('welcome.cloneStart')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
