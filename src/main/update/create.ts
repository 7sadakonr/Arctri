import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '@shared/types/update';
import { logger } from '../logger';
import { FakeUpdater, fakeModeFromEnv } from './fake-updater';
import { UpdateService, type UpdaterLike } from './update-service';

// Only a loopback feed is accepted, so the variable can point an installed build at a local test server and nowhere else.
const TEST_FEED = /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/;

export function createUpdateService(o: {
  busyCount: () => number;
  emit: (channel: string, status: UpdateStatus) => void;
  onInstall: () => void;
}): UpdateService {
  const testFeed = process.env['ARCTRI_UPDATE_TEST_FEED'];
  let updater: UpdaterLike;
  if (app.isPackaged) {
    const real = electronUpdater.autoUpdater;
    if (testFeed && TEST_FEED.test(testFeed)) {
      real.setFeedURL({ provider: 'generic', url: testFeed });
      // The test feed is a plain file server without range requests.
      real.disableDifferentialDownload = true;
    }
    updater = real as unknown as UpdaterLike;
  } else {
    updater = new FakeUpdater(fakeModeFromEnv(process.env['ARCTRI_UPDATE_FAKE']));
  }
  return new UpdateService({
    updater,
    currentVersion: app.getVersion(),
    // The Windows installer replaces itself unsigned (the manifest checksum still applies). macOS needs a signed app, so it only links to the release.
    canAutoInstall: process.platform === 'win32' && (app.isPackaged || !!process.env['ARCTRI_UPDATE_FAKE']),
    busyCount: o.busyCount,
    onInstall: o.onInstall,
    emit: (status) => o.emit('update:status', status),
    log: (msg, detail) => logger.info(msg, detail)
  });
}
