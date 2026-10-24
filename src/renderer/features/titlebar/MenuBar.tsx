import { kbd } from '@/lib/platform';
import { useRef, useState } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { editCopy, editPaste, editSelectAll } from '@/lib/edit-actions';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { useMenus, type Entry } from './menus';

function Entries({ entries }: { entries: Entry[] }) {
  return (
    <>
      {entries.map((e, i) => {
        if ('sep' in e) return <DropdownMenuSeparator key={`s${i}`} />;
        if (e.sub) {
          return (
            <DropdownMenuSub key={e.label}>
              <DropdownMenuSubTrigger>{e.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <Entries entries={e.sub} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        }
        return (
          <DropdownMenuItem key={e.label} disabled={!!e.disabled} onSelect={() => e.run?.()}>
            <span className="w-3 text-center">{e.checked ? '✓' : ''}</span>
            <span className="flex-1 truncate">{e.label}</span>
            {e.detail && <span className="max-w-[260px] truncate text-[10px] text-fg-muted" dir="rtl"><bdi>{e.detail}</bdi></span>}
            {e.shortcut && <DropdownMenuShortcut>{e.shortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

/** File / Edit / View / Terminal / Help. Opening one and moving over another switches menus, as in VS Code. */
export function MenuBar() {
  const t = useT();
  const menus = useMenus();
  const [open, setOpen] = useState<string | null>(null);
  const openNow = useRef<string | null>(null);
  openNow.current = open;
  // What had the focus before a menu took it: Edit > Copy/Paste must act on that, not on the menu.
  const before = useRef<Element | null>(null);
  const remember = () => {
    const el = document.activeElement;
    before.current = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el : null;
  };

  const edit: Entry[] = [
    { label: t('menu.copy'), shortcut: kbd('Mod+C'), run: () => editCopy(before.current) },
    { label: t('menu.paste'), shortcut: kbd('Mod+V'), run: () => void editPaste(before.current) },
    { label: t('menu.selectAll'), shortcut: kbd('Mod+A'), run: () => editSelectAll(before.current) },
  ];

  return (
    <div className="no-drag flex items-center" role="menubar">
      {menus.map((m) => (
        <DropdownMenu
          key={m.id}
          modal={false}
          open={open === m.id}
          onOpenChange={(o) => setOpen((cur) => (o ? m.id : cur === m.id ? null : cur))}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onPointerDownCapture={remember}
              onPointerEnter={() => open && open !== m.id && setOpen(m.id)}
              className="rounded px-2 py-1 text-[12px] text-fg-muted outline-none hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
            >
              {m.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={2}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              // Switching to another menu must not pull the focus out from under it.
              if (openNow.current === null) focusActiveSession();
            }}
          >
            <Entries entries={m.id === 'edit' ? edit : m.entries} />
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  );
}
