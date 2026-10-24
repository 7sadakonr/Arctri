import { useEffect, useRef } from 'react';
import type { NativeMenuItem } from '@shared/ipc/contract';
import { api } from '@/lib/api';
import { editCopy, editPaste, editSelectAll } from '@/lib/edit-actions';
import { useT } from '@/lib/i18n';
import { useMenus, type Entry } from './menus';

type Runs = Map<string, () => void>;

function convert(entries: Entry[], path: string, runs: Runs): NativeMenuItem[] {
  return entries.map((e, i): NativeMenuItem => {
    if ('sep' in e) return { sep: true };
    const id = `${path}.${i}`;
    if (e.sub) return { label: e.label, submenu: convert(e.sub, id, runs) };
    if (e.run) runs.set(id, e.run);
    return {
      id,
      label: e.label,
      ...(e.accelerator ? { accelerator: e.accelerator } : {}),
      ...(e.disabled ? { enabled: false } : {}),
      ...(e.checked ? { checked: true } : {})
    };
  });
}

/**
 * macOS: the menus live in the system menu bar. This renders nothing; it hands the menus to the main process
 * whenever they change and runs the entry the user picked. Exit is left out: the app menu has Quit.
 */
export function NativeMenu() {
  const t = useT();
  const menus = useMenus();
  const runs = useRef<Runs>(new Map());

  useEffect(() => {
    const next: Runs = new Map();
    const hidden = new Set([t('menu.exit')]);
    const model = menus.map((m) => {
      if (m.id === 'edit') {
        // the system menu does not take the focus, so what is focused now is what Copy and Paste act on
        const field = () => document.activeElement;
        next.set('edit.copy', () => editCopy(field()));
        next.set('edit.paste', () => void editPaste(field()));
        next.set('edit.selectAll', () => editSelectAll(field()));
        return {
          label: m.label,
          items: [
            { label: t('menu.copy'), id: 'edit.copy', accelerator: 'Cmd+C' },
            { label: t('menu.paste'), id: 'edit.paste', accelerator: 'Cmd+V' },
            { label: t('menu.selectAll'), id: 'edit.selectAll', accelerator: 'Cmd+A' }
          ] satisfies NativeMenuItem[]
        };
      }
      const kept = m.entries.filter((e) => 'sep' in e || !hidden.has(e.label));
      return { label: m.label, items: convert(kept, m.id, next) };
    });
    runs.current = next;
    void api.app.setMenu(model);
  }, [menus, t]);

  useEffect(() => api.app.onMenu(({ id }) => runs.current.get(id)?.()), []);
  return null;
}
