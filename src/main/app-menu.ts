import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { NativeMenuItem } from '@shared/ipc/contract';

/**
 * The application menu on macOS. The window has its own menu bar everywhere else (Windows); on a Mac the system menu
 * bar must exist for Cmd+Q, Cmd+H, Cmd+M and the standard Edit commands to work.
 * Copy, Paste and friends keep their shortcut shown but are not registered with the system, so the key press still
 * reaches the page: the terminal decides itself whether Cmd+C copies or not.
 */
export function installAppMenu(platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut', registerAccelerator: false },
        { role: 'copy', registerAccelerator: false },
        { role: 'paste', registerAccelerator: false },
        { role: 'selectAll', registerAccelerator: false }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function toTemplate(items: NativeMenuItem[], click: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((it): MenuItemConstructorOptions => {
    if ('sep' in it) return { type: 'separator' };
    const { id, label, accelerator, enabled, checked, submenu } = it;
    if (submenu) return { label, enabled: enabled !== false, submenu: toTemplate(submenu, click) };
    return {
      label,
      enabled: enabled !== false,
      // shown only: the page handles the key press itself, so the system must not fire the item a second time
      registerAccelerator: false,
      ...(accelerator ? { accelerator } : {}),
      ...(checked ? { type: 'checkbox' as const, checked: true } : {}),
      ...(id ? { click: () => click(id) } : {})
    };
  });
}

/**
 * macOS: the page's menus (File, Edit, View, Terminal, Help) go into the system menu bar, between the app menu and Window.
 * A click is reported back by the id the page gave the entry.
 */
export function setAppMenus(menus: Array<{ label: string; items: NativeMenuItem[] }>, click: (id: string) => void): void {
  if (process.platform !== 'darwin') return;
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    ...menus.map((m): MenuItemConstructorOptions => ({ label: m.label, submenu: toTemplate(m.items, click) })),
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
