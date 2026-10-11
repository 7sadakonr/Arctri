import type { ShellProfile } from '@shared/types/env';
import type { WslDistro, WslStatus } from '@shared/types/wsl';
import { logger } from '../logger';
import type { WslManager } from '../wsl/wsl-manager';
import { wslExePath } from '../wsl/wsl-manager';
import { discoverWindowsProfiles, probeZshAll, wslProfilesFor, type ZshCache } from './discovery';
import { loadWindowsTerminalProfiles, normalizeDistro } from './wt-settings';

export interface ProfilesResult {
  profiles: ShellProfile[];
  wsl: WslStatus;
  /** The profile Windows Terminal starts by default. */
  defaultProfileId?: string;
}

/** What is remembered between runs, so WSL shells are there before WSL has answered. */
export interface RegistryCache {
  zsh: ZshCache;
  distros: { get(): WslDistro[]; set(value: WslDistro[]): void };
}

const CLEAR = new Set(['not-installed', 'disabled', 'no-distros']);

export class ProfileRegistry {
  private windows: ShellProfile[] = [];
  private order: string[] = [];
  private wtDefault: string | undefined;
  private distros: WslDistro[];
  private wslStatus: WslStatus = { available: false, reason: 'loading' };
  private loaded = false;
  private initial: Promise<unknown> | undefined;
  private inflight: Promise<void> | undefined;
  private zshRun: Promise<void> | undefined;

  constructor(private readonly wsl: WslManager, private readonly cache?: RegistryCache) {
    this.discoverWindows();
    this.distros = cache?.distros.get() ?? [];
    if (this.distros.some((d) => !d.hidden)) this.wslStatus = this.availableStatus();
  }

  private availableStatus(): WslStatus {
    const def = this.distros.find((d) => d.isDefault && !d.hidden)?.name ?? this.distros.find((d) => !d.hidden)?.name;
    return def ? { available: true, defaultDistro: def } : { available: true };
  }

  private discoverWindows(): void {
    const base = discoverWindowsProfiles();
    const wt = loadWindowsTerminalProfiles(base);
    this.windows = wt ? wt.windows : base;
    this.order = wt ? wt.order : [];
    this.wtDefault = wt?.defaultId;
  }

  /** Probes WSL without blocking the caller; `whenWslReady` resolves when the first probe has finished. */
  startBackgroundRefresh(): void {
    this.initial = this.refresh(true).catch(() => undefined);
  }

  async whenWslReady(): Promise<void> {
    await this.initial;
  }

  /** One probe at a time: callers that arrive while one is running share its result. */
  private probeWsl(): Promise<void> {
    this.inflight ??= (async () => {
      try {
        const status = await this.wsl.status(true);
        if (status.available) {
          this.distros = await this.wsl.listDistros();
          this.wslStatus = status;
          this.cache?.distros.set(this.distros);
          // Nothing is known about zsh yet (first run, or a new distribution): wait for it once, so the first menu is complete.
          const firstTime = this.distros.some((d) => !d.hidden && this.cache?.zsh.get()[d.name] === undefined);
          const run = this.probeZsh();
          if (firstTime) await run;
        } else if (CLEAR.has(status.reason)) {
          this.distros = [];
          this.wslStatus = status;
          this.cache?.distros.set([]);
        } else {
          // WSL did not answer (starting up, busy): what was known stays, instead of every distribution vanishing.
          logger.warn(`wsl probe failed (${status.reason}${'detail' in status && status.detail ? `: ${status.detail}` : ''}); keeping ${this.distros.length} known distribution(s)`);
          if (this.distros.length === 0) this.wslStatus = status;
        }
        this.loaded = true;
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  /** Otherwise in the background: finding out about zsh may have to start a distribution, which must not hold up anything. */
  private probeZsh(): Promise<void> {
    if (!this.cache) return Promise.resolve();
    const cache = this.cache;
    this.zshRun ??= probeZshAll(this.wsl, this.distros, cache.zsh)
      .catch((e) => logger.warn('zsh probe failed', e))
      .finally(() => {
        this.zshRun = undefined;
      });
    return this.zshRun;
  }

  async refresh(refreshWsl = true): Promise<ProfilesResult> {
    if (!refreshWsl && !this.loaded) return this.snapshot(); // WSL not probed yet: what is known from before
    this.discoverWindows();
    if (refreshWsl || !this.loaded) await this.probeWsl();
    return this.snapshot();
  }

  snapshot(): ProfilesResult {
    const wslProfiles = wslProfilesFor(this.distros, wslExePath(), this.cache?.zsh.get() ?? {});
    const all = [...this.windows, ...wslProfiles];
    // A Store distribution in Windows Terminal (`wslapp:ubuntu`) stands for the distribution whose name matches it.
    const distros = wslProfiles.filter((p) => p.autoShell);
    const resolve = (id: string): string => {
      if (!id.startsWith('wslapp:')) return id.toLowerCase();
      const key = id.slice('wslapp:'.length);
      const same = (d: ShellProfile) => normalizeDistro(d.env.kind === 'wsl' ? d.env.distro : '');
      const hit = distros.find((d) => same(d) === key) ?? distros.find((d) => same(d).startsWith(key) || key.startsWith(same(d)));
      return hit ? hit.id.toLowerCase() : id;
    };
    const order = this.order.map(resolve);
    const rank = (p: ShellProfile): number => {
      const id = p.id.toLowerCase();
      const i = order.indexOf(id);
      if (i >= 0) return i;
      // `wsl:<distro>:zsh|bash` stay right below their distribution
      const parent = order.indexOf(id.replace(/:(zsh|bash)$/, ''));
      return parent >= 0 ? parent + 0.5 : order.length;
    };
    const profiles = order.length > 0 ? all.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p) : all;
    const wanted = this.wtDefault ? resolve(this.wtDefault) : undefined;
    const def = wanted ? profiles.find((p) => p.id.toLowerCase() === wanted) : undefined;
    // Reported even while the profile is not discovered yet, so the caller knows to wait for it.
    const defaultProfileId = def?.id ?? this.wtDefault;
    return { profiles, wsl: this.wslStatus, ...(defaultProfileId ? { defaultProfileId } : {}) };
  }

  get(id: string): ShellProfile | undefined {
    const { profiles } = this.snapshot();
    const hit = profiles.find((p) => p.id === id);
    if (hit) return hit;
    // Ids from earlier versions (`wsl:<distro>:bash|zsh`) keep working, whether or not the distribution is running.
    const m = /^wsl:(.+):(bash|zsh)$/.exec(id);
    const distro = m && profiles.find((p) => p.id.toLowerCase() === `wsl:${m[1]}`.toLowerCase());
    if (m && distro) {
      const { autoShell: _auto, ...rest } = distro;
      return { ...rest, id, label: `${distro.label} · ${m[2]}`, shell: m[2] as 'bash' | 'zsh' };
    }
    return undefined;
  }
}
