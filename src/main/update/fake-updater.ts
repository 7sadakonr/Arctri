import type { UpdaterLike } from './update-service';

export type FakeMode = 'none' | 'available' | 'error' | 'slow';

/** Stands in for electron-updater in development and end-to-end runs, where there is no installed build to replace. */
export class FakeUpdater implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = false;
  installed = 0;
  private progress: Array<(p: { percent: number; bytesPerSecond: number }) => void> = [];

  constructor(private readonly mode: FakeMode, private readonly version = '99.0.0') {}

  on(event: string, cb: (...a: never[]) => void): this {
    if (event === 'download-progress') this.progress.push(cb as never);
    return this;
  }

  async checkForUpdates() {
    if (this.mode === 'error') throw new Error('getaddrinfo ENOTFOUND github.com');
    if (this.mode === 'slow') await new Promise((r) => setTimeout(r, 1500));
    return { isUpdateAvailable: this.mode === 'available' || this.mode === 'slow', updateInfo: { version: this.version } };
  }

  async downloadUpdate() {
    for (const percent of [25, 60, 100]) {
      await new Promise((r) => setTimeout(r, 120));
      this.progress.forEach((cb) => cb({ percent, bytesPerSecond: 1_000_000 }));
    }
  }

  quitAndInstall() {
    this.installed++;
  }
}

export const fakeModeFromEnv = (v: string | undefined): FakeMode =>
  v === 'available' || v === 'error' || v === 'slow' ? v : 'none';
