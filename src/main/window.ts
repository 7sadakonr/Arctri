import { BrowserWindow, dialog, screen, session, shell } from 'electron';
import { join } from 'node:path';
import type { PrefsStore } from './persistence/prefs';

export const isDev = (): boolean => !!process.env['ELECTRON_RENDERER_URL'];

export function appOrigins(): string[] {
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (dev) return [dev.replace(/\/$/, '')];
  return [new URL('file://' + join(import.meta.dirname, '../renderer/index.html').replace(/\\/g, '/')).href.replace('file://', 'file:///').replace('file:////', 'file:///')];
}

function installCsp(): void {
  const dev = isDev();
  const policy = dev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: http://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } });
  });
  // Terminal programs never need browser permissions.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write' || permission === 'clipboard-read'));
}

function boundsVisible(b: { x?: number | undefined; y?: number | undefined; width: number; height: number }): boolean {
  if (b.x === undefined || b.y === undefined) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x! + 80 > a.x && b.x! + 80 < a.x + a.width && b.y! + 20 > a.y && b.y! + 20 < a.y + a.height;
  });
}

export interface WindowHooks {
  /** Number of sessions running something that would be lost on close. */
  busyCount: () => number;
}

export function createMainWindow(prefs: PrefsStore, hooks: WindowHooks): BrowserWindow {
  installCsp();
  const w = prefs.get().window;
  const win = new BrowserWindow({
    width: w.width,
    height: w.height,
    ...(boundsVisible(w) ? { x: w.x!, y: w.y! } : {}),
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: prefs.get().theme === 'light' ? '#f6f7f9' : '#0e0f13',
    title: 'AgentDock',
    // the packaged exe embeds its icon; this only gives development runs the same one
    ...(isDev() ? { icon: join(import.meta.dirname, '../../build/icon.png') } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: prefs.get().theme === 'light'
      ? { color: '#fbfbfd', symbolColor: '#23252e', height: 36 }
      : { color: '#0e0f13', symbolColor: '#c9ccd6', height: 36 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });
  if (w.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  let timer: ReturnType<typeof setTimeout> | undefined;
  const saveBounds = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getNormalBounds();
      prefs.set({ window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() } });
    }, 400);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!appOrigins().some((o) => url.startsWith(o))) e.preventDefault();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (isDev() && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) e.preventDefault();
  });

  let confirmed = false;
  win.on('close', (e) => {
    if (confirmed) return;
    const busy = hooks.busyCount();
    // Automated runs must never wait for a person to answer a dialog.
    if (busy > 0 && !process.env['AGENTDOCK_E2E'] && !process.env['AGENTDOCK_SMOKE_OUT']) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'AgentDock',
        message: busy === 1 ? '1 session is still running.' : `${busy} sessions are still running.`,
        detail: 'Closing the window ends their processes.'
      });
      if (choice !== 0) {
        e.preventDefault();
        return;
      }
    }
    confirmed = true;
  });

  if (isDev()) void win.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}
