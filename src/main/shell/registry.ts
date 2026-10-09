import type { ShellProfile } from '@shared/types/env';
import type { WslStatus } from '@shared/types/wsl';
import type { WslManager } from '../wsl/wsl-manager';
import { wslExePath } from '../wsl/wsl-manager';
import { discoverWindowsProfiles, discoverWslProfiles } from './discovery';

export interface ProfilesResult {
  profiles: ShellProfile[];
  wsl: WslStatus;
}

export class ProfileRegistry {
  private windows = discoverWindowsProfiles();
  private wslProfiles: ShellProfile[] = [];
  private wslStatus: WslStatus = { available: false, reason: 'loading' };
  private loaded = false;
  private initial: Promise<unknown> | undefined;

  constructor(private readonly wsl: WslManager) {}

  /** Probes WSL without blocking the caller; `whenWslReady` resolves when the first probe has finished. */
  startBackgroundRefresh(): void {
    this.initial = this.refresh(true).catch(() => undefined);
  }

  async whenWslReady(): Promise<void> {
    await this.initial;
  }

  async refresh(refreshWsl = true): Promise<ProfilesResult> {
    if (!refreshWsl && !this.loaded) return this.snapshot(); // WSL not probed yet: Windows shells only
    if (refreshWsl || !this.loaded) {
      this.windows = discoverWindowsProfiles();
      this.wslStatus = await this.wsl.status(true);
      this.wslProfiles = this.wslStatus.available ? await discoverWslProfiles(this.wsl, wslExePath()) : [];
      this.loaded = true;
    }
    return this.snapshot();
  }

  snapshot(): ProfilesResult {
    return { profiles: [...this.windows, ...this.wslProfiles], wsl: this.wslStatus };
  }

  get(id: string): ShellProfile | undefined {
    return this.snapshot().profiles.find((p) => p.id === id);
  }
}
