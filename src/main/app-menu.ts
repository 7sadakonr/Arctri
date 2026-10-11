import { Menu, type MenuItemConstructorOptions } from 'electron';

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
