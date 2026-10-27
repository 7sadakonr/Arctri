import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@shared/types/update';
import { UpdateService, classifyUpdateError, defaultChannel, type UpdaterLike } from './update-service';

class FakeUpdater implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = true;
  channel: string | null = null;
  checks = 0;
  downloads = 0;
  installs = 0;
  checkImpl: () => Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } } | null> = async () => ({
    isUpdateAvailable: false, updateInfo: { version: '1.0.0' }
  });
  downloadImpl: () => Promise<unknown> = async () => undefined;
  progress: Array<(p: { percent: number; bytesPerSecond: number }) => void> = [];
  on(event: string, cb: never): this {
    if (event === 'download-progress') this.progress.push(cb);
    return this;
  }
  checkForUpdates() {
    this.checks++;
    return this.checkImpl();
  }
  downloadUpdate() {
    this.downloads++;
    return this.downloadImpl();
  }
  quitAndInstall() {
    this.installs++;
  }
}

function setup(over: { version?: string; canAutoInstall?: boolean; busy?: number } = {}) {
  const approved: number[] = [];
  const updater = new FakeUpdater();
  const events: UpdateStatus[] = [];
  const busy = { n: over.busy ?? 0 };
  const svc = new UpdateService({
    updater,
    currentVersion: over.version ?? '0.3.3-beta',
    canAutoInstall: over.canAutoInstall ?? true,
    busyCount: () => busy.n,
    emit: (s) => events.push(s),
    onInstall: () => void approved.push(1),
    now: () => 1234
  });
  return { updater, svc, events, busy, approved };
}

const available = (version = '0.4.0-beta.1') => async () => ({ isUpdateAvailable: true, updateInfo: { version } });

describe('UpdateService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never downloads or installs by itself', () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
  });

  it('follows the channel of the installed version until a preference is set', () => {
    expect(defaultChannel('0.3.3-beta')).toBe('beta');
    expect(defaultChannel('1.0.0')).toBe('stable');
    const { updater, svc } = setup();
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.channel).toBe('beta');
    svc.configure({ autoCheck: false, channel: 'stable' });
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.channel).toBe('latest');
    expect(svc.status().channel).toBe('stable');
  });

  it('goes idle -> checking -> up-to-date and records the time', async () => {
    const { svc, events } = setup();
    expect(svc.status().phase.kind).toBe('idle');
    const s = await svc.check();
    expect(events.map((e) => e.phase.kind)).toEqual(['checking', 'up-to-date']);
    expect(s.lastCheckedAt).toBe(1234);
  });

  it('reports an available version, downloads it with progress, then is downloaded', async () => {
    const { svc, updater, events } = setup();
    updater.checkImpl = available();
    expect((await svc.check()).phase).toEqual({ kind: 'available', version: '0.4.0-beta.1' });
    updater.downloadImpl = async () => updater.progress.forEach((cb) => cb({ percent: 41.6, bytesPerSecond: 10 }));
    const s = await svc.download();
    expect(s.phase).toEqual({ kind: 'downloaded', version: '0.4.0-beta.1' });
    expect(events.some((e) => e.phase.kind === 'downloading' && e.phase.percent === 42)).toBe(true);
  });

  it('shares one request between concurrent checks and concurrent downloads', async () => {
    const { svc, updater } = setup();
    updater.checkImpl = available();
    await Promise.all([svc.check(), svc.check(), svc.check()]);
    expect(updater.checks).toBe(1);
    await Promise.all([svc.download(), svc.download()]);
    expect(updater.downloads).toBe(1);
  });

  it('does not check again while an update is downloaded, so it is never discarded', async () => {
    const { svc, updater } = setup();
    updater.checkImpl = available();
    await svc.check();
    await svc.download();
    await svc.check();
    expect(updater.checks).toBe(1);
    expect(svc.status().phase.kind).toBe('downloaded');
  });

  it('turns an offline failure into a recoverable error', async () => {
    const { svc, updater } = setup();
    updater.checkImpl = async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    };
    const s = await svc.check();
    expect(s.phase).toMatchObject({ kind: 'error', code: 'offline' });
    updater.checkImpl = async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.3.3-beta' } });
    expect((await svc.check()).phase.kind).toBe('up-to-date');
  });

  it('times out a check that never answers', async () => {
    const { svc, updater } = setup();
    updater.checkImpl = () => new Promise(() => undefined);
    const p = svc.check();
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await p).phase).toMatchObject({ kind: 'error', code: 'timeout' });
  });

  it('maps a rejected download to an error and keeps the app usable', async () => {
    const { svc, updater } = setup();
    updater.checkImpl = available();
    await svc.check();
    updater.downloadImpl = async () => {
      throw new Error('sha512 checksum mismatch, expected a, got b');
    };
    expect((await svc.download()).phase).toMatchObject({ kind: 'error', code: 'checksum' });
    expect(updater.installs).toBe(0);
  });

  it('refuses to install before a download finished', async () => {
    const { svc, updater } = setup();
    updater.checkImpl = available();
    await svc.check();
    expect(svc.install(true)).toEqual({ started: false, blocked: 'not-ready' });
    expect(updater.installs).toBe(0);
  });

  it('blocks an install that would end running work until the user confirms', async () => {
    const { svc, updater, busy } = setup({ busy: 2 });
    updater.checkImpl = available();
    await svc.check();
    await svc.download();
    expect(svc.install(false)).toEqual({ started: false, blocked: 'busy', busy: 2 });
    expect(updater.installs).toBe(0);
    expect(svc.install(true)).toEqual({ started: true });
    expect(updater.installs).toBe(1);
    busy.n = 0;
  });

  it('tells the app the quit is approved only when an install really starts', async () => {
    const { svc, updater, approved } = setup({ busy: 1 });
    updater.checkImpl = available();
    await svc.check();
    await svc.download();
    svc.install(false);
    expect(approved).toEqual([]);
    svc.install(true);
    expect(approved).toEqual([1]);
  });

  it('installs without confirmation when nothing is running', async () => {
    const { svc, updater } = setup({ busy: 0 });
    updater.checkImpl = available();
    await svc.check();
    await svc.download();
    expect(svc.install(false)).toEqual({ started: true });
  });

  it('only points at the release page where the app cannot replace itself', async () => {
    const { svc, updater } = setup({ canAutoInstall: false });
    updater.checkImpl = available('0.4.0-beta.1');
    await svc.check();
    expect(svc.status().canAutoInstall).toBe(false);
    expect((await svc.download()).phase.kind).toBe('available');
    expect(updater.downloads).toBe(0);
    expect(svc.install(true)).toEqual({ started: false, blocked: 'not-ready' });
    expect(svc.releasePageUrl()).toBe('https://github.com/7sadakonr/Arctri/releases/tag/v0.4.0-beta.1');
  });

  it('checks once after the startup delay and then on the interval, only while automatic checks are on', async () => {
    const { svc, updater } = setup();
    svc.configure({ autoCheck: true });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(updater.checks).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(updater.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(6 * 3_600_000);
    expect(updater.checks).toBe(2);
    svc.configure({ autoCheck: false });
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(updater.checks).toBe(2);
    await svc.check();
    expect(updater.checks).toBe(3);
  });

  it('stops scheduling once disposed', async () => {
    const { svc, updater } = setup();
    svc.configure({ autoCheck: true });
    svc.dispose();
    await vi.advanceTimersByTimeAsync(10 * 3_600_000);
    expect(updater.checks).toBe(0);
  });
});

describe('classifyUpdateError', () => {
  it('groups failures and keeps only the first line of the message', () => {
    expect(classifyUpdateError(new Error('getaddrinfo ENOTFOUND github.com')).code).toBe('offline');
    expect(classifyUpdateError(new Error('Cannot find latest.yml in the latest release artifacts (404)')).code).toBe('not-found');
    expect(classifyUpdateError(new Error('sha512 checksum mismatch')).code).toBe('checksum');
    expect(classifyUpdateError(new Error('boom')).code).toBe('unknown');
    expect(classifyUpdateError(new Error('first\nHeaders: {secret}')).message).toBe('first');
  });
});
