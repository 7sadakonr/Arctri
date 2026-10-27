import type {
  UpdateChannel, UpdateErrorCode, UpdateInstallResult, UpdatePhase, UpdateStatus
} from '@shared/types/update';

/** The slice of electron-updater's `AppUpdater` this service relies on; tests and development runs supply their own. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: 'download-progress', cb: (p: { percent: number; bytesPerSecond: number }) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateServiceOptions {
  updater: UpdaterLike;
  currentVersion: string;
  canAutoInstall: boolean;
  /** Sessions with running work; an install that would end them needs the user's explicit confirmation. */
  busyCount: () => number;
  emit: (status: UpdateStatus) => void;
  /** Called once the user's go-ahead for an install is certain, right before the app restarts. */
  onInstall?: () => void;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
  now?: () => number;
  checkTimeoutMs?: number;
  initialDelayMs?: number;
  intervalMs?: number;
}

const HOUR = 3_600_000;

/** A version with a prerelease part (`0.3.3-beta`) follows the beta channel until the user picks one. */
export const defaultChannel = (version: string): UpdateChannel => (version.includes('-') ? 'beta' : 'stable');

export function classifyUpdateError(err: unknown): { code: UpdateErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.toLowerCase();
  let code: UpdateErrorCode = 'unknown';
  if (/enotfound|econnrefused|econnreset|etimedout|eai_again|err_internet_disconnected|err_network|err_name_not_resolved|net::/.test(m)) code = 'offline';
  else if (/\b404\b|cannot find latest|no published versions|not found/.test(m)) code = 'not-found';
  else if (/sha512|checksum|signature/.test(m)) code = 'checksum';
  else if (m.includes('timed out')) code = 'timeout';
  // Only the first line: electron-updater appends request headers and response bodies.
  return { code, message: message.split('\n')[0]!.slice(0, 300) };
}

/**
 * Update lifecycle for the main process: idle -> checking -> up-to-date | available -> downloading -> downloaded.
 * Nothing here installs without a call from the user (`install`), and an install never ends running work unconfirmed.
 */
export class UpdateService {
  private phase: UpdatePhase = { kind: 'idle' };
  private channel: UpdateChannel;
  private autoCheck = true;
  private lastCheckedAt: number | null = null;
  private checking: Promise<UpdateStatus> | undefined;
  private downloading: Promise<UpdateStatus> | undefined;
  private initialTimer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(private readonly o: UpdateServiceOptions) {
    this.channel = defaultChannel(o.currentVersion);
    o.updater.autoDownload = false;
    o.updater.autoInstallOnAppQuit = false;
    o.updater.allowDowngrade = false;
    this.applyChannel();
    o.updater.on('download-progress', (p) => {
      if (this.phase.kind !== 'downloading') return;
      this.set({ kind: 'downloading', version: this.phase.version, percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond });
    });
    // Failures also reject the awaited call; this listener only keeps an unhandled 'error' event from reaching the process.
    o.updater.on('error', (err) => this.o.log?.('updater error', { message: classifyUpdateError(err).message }));
  }

  status(): UpdateStatus {
    return {
      phase: this.phase,
      currentVersion: this.o.currentVersion,
      channel: this.channel,
      lastCheckedAt: this.lastCheckedAt,
      canAutoInstall: this.o.canAutoInstall
    };
  }

  /** Applies the user's preferences and starts the schedule: one check shortly after startup, then a slow interval. */
  configure(prefs: { autoCheck: boolean; channel?: UpdateChannel | undefined }): void {
    this.autoCheck = prefs.autoCheck;
    const channel = prefs.channel ?? defaultChannel(this.o.currentVersion);
    if (channel !== this.channel) {
      this.channel = channel;
      this.applyChannel();
      if (this.phase.kind === 'available' || this.phase.kind === 'up-to-date') this.set({ kind: 'idle' });
    }
    this.reschedule();
  }

  check(): Promise<UpdateStatus> {
    if (this.checking) return this.checking;
    // A downloaded update stays; checking again could only discard it.
    if (this.phase.kind === 'downloading' || this.phase.kind === 'downloaded') return Promise.resolve(this.status());
    this.set({ kind: 'checking' });
    const run = async (): Promise<UpdateStatus> => {
      try {
        const r = await this.withTimeout(this.o.updater.checkForUpdates(), this.o.checkTimeoutMs ?? 30_000);
        this.lastCheckedAt = (this.o.now ?? Date.now)();
        if (r?.isUpdateAvailable) {
          this.set({ kind: 'available', version: r.updateInfo.version });
        } else this.set({ kind: 'up-to-date' });
      } catch (err) {
        this.lastCheckedAt = (this.o.now ?? Date.now)();
        this.fail(err);
      }
      return this.status();
    };
    this.checking = run().finally(() => (this.checking = undefined));
    return this.checking;
  }

  download(): Promise<UpdateStatus> {
    if (this.downloading) return this.downloading;
    if (this.phase.kind !== 'available' || !this.o.canAutoInstall) return Promise.resolve(this.status());
    const version = this.phase.version;
    this.set({ kind: 'downloading', version, percent: 0, bytesPerSecond: 0 });
    const run = async (): Promise<UpdateStatus> => {
      try {
        await this.o.updater.downloadUpdate();
        this.set({ kind: 'downloaded', version });
      } catch (err) {
        this.fail(err);
      }
      return this.status();
    };
    this.downloading = run().finally(() => (this.downloading = undefined));
    return this.downloading;
  }

  /** Restarts into the downloaded update. Running work is never ended without `confirmBusy`. */
  install(confirmBusy: boolean): UpdateInstallResult {
    if (this.phase.kind !== 'downloaded' || !this.o.canAutoInstall) return { started: false, blocked: 'not-ready' };
    const busy = this.o.busyCount();
    if (busy > 0 && !confirmBusy) return { started: false, blocked: 'busy', busy };
    this.o.log?.('installing update', { version: this.phase.version });
    this.o.onInstall?.();
    this.o.updater.quitAndInstall(false, true);
    return { started: true };
  }

  releasePageUrl(): string {
    const v = this.phase.kind === 'available' || this.phase.kind === 'downloading' || this.phase.kind === 'downloaded' ? this.phase.version : undefined;
    const base = 'https://github.com/7sadakonr/Arctri/releases';
    return v ? `${base}/tag/v${v}` : base;
  }

  dispose(): void {
    this.disposed = true;
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.interval) clearInterval(this.interval);
  }

  /**
   * With GitHub Releases the channel is the prerelease flag of the release, not a metadata file name: every release carries
   * latest.yml, and `allowPrerelease` decides whether prereleases are considered. (Setting `updater.channel` to "beta" would
   * look for a beta.yml that electron-builder does not write for GitHub.)
   */
  private applyChannel(): void {
    this.o.updater.allowPrerelease = this.channel === 'beta';
  }

  private reschedule(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.interval) clearInterval(this.interval);
    this.initialTimer = this.interval = undefined;
    if (this.disposed || !this.autoCheck) return;
    const tick = () => {
      if (this.autoCheck && !this.disposed) void this.check();
    };
    this.initialTimer = setTimeout(tick, this.o.initialDelayMs ?? 30_000);
    this.interval = setInterval(tick, this.o.intervalMs ?? 6 * HOUR);
  }

  private fail(err: unknown): void {
    const e = classifyUpdateError(err);
    this.o.log?.('update failed', { code: e.code, message: e.message });
    this.set({ kind: 'error', code: e.code, message: e.message });
  }

  private set(phase: UpdatePhase): void {
    this.phase = phase;
    this.o.emit(this.status());
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('update check timed out')), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }
}
