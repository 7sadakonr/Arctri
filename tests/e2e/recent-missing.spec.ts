import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './fixtures';

// A recent project whose folder was moved or deleted used to open a tab that died at once with "code 1" and no reason,
// and stayed in the list. Now no tab opens, the person is told, and the entry is removed. Skipped on Windows only because
// the folders below are POSIX paths.
test.skip(process.platform === 'win32', 'POSIX folders');

test('a recent project whose folder is gone opens no tab, says so, and leaves the list', async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'arctri-recent-'));
  const userData = join(root, 'profile');
  const alive = join(root, 'alive-project');
  const gone = join(root, 'gone-project');
  mkdirSync(userData, { recursive: true });
  mkdirSync(alive, { recursive: true });
  const now = Date.now();
  writeFileSync(
    join(userData, 'preferences.json'),
    JSON.stringify({ prefs: { recentProjects: [{ env: 'local', path: gone, openedAt: now }, { env: 'local', path: alive, openedAt: now - 1 }] } })
  );
  const f = await launch({ ARCTRI_E2E_WELCOME: '1' }, userData);
  const { page } = f;
  try {
    const tabs = page.locator('[role="tab"][data-tab-kind="session"]');
    await expect(page.getByText('gone-project', { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByText('gone-project', { exact: true }).click();
    await expect(page.getByText(/no longer exists|ไม่พบโฟลเดอร์/)).toBeVisible({ timeout: 10_000 });
    await expect(tabs).toHaveCount(0);
    await expect(page.getByText('gone-project', { exact: true })).toHaveCount(0);
    await expect.poll(() => readFileSync(join(userData, 'preferences.json'), 'utf8').includes('gone-project')).toBe(false);

    // a folder that is there still opens
    await page.getByText('alive-project', { exact: true }).click();
    await expect(tabs).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await f.app.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});
