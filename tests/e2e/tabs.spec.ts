import { activeBlocks, activeEditor, expect, expectNewTabSelected, settled, test, waitForEditor } from './fixtures';

const blocks = activeBlocks;

test('several tabs: processes keep running in the background, rename, close ends the process', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  const editor = () => activeEditor(page);

  // start something slow in tab 1, then work in tab 2
  await editor().fill('Start-Sleep 4; echo slow-done');
  await editor().press('Enter');
  await expect(page.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press('Control+Shift+T');
  await expectNewTabSelected(page, 2);
  await waitForEditor(page, 40_000);
  await editor().fill('echo second-tab');
  await editor().press('Enter');
  await settled(page, 1);
  await expect(blocks(page).first()).toContainText('second-tab');

  // go back: the first command finished while the tab was hidden
  await page.keyboard.press('Control+1');
  await settled(page, 1, 20_000);
  await expect(blocks(page).first()).toContainText('slow-done');

  // rename with F2
  await page.keyboard.press('F2');
  await page.getByRole('tab').first().locator('input').fill('ทดสอบ rename');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab').first()).toContainText('ทดสอบ rename');

  // closing a tab ends its process
  const pids = await page.evaluate(() =>
    (window as unknown as { __arctriTest: { sessions(): Array<{ pid: number }> } }).__arctriTest.sessions().map((s) => s.pid)
  );
  expect(pids).toHaveLength(2);
  await page.getByRole('tab').nth(1).getByRole('button', { name: /close tab/i }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect
    .poll(() => {
      try {
        process.kill(pids[1]!, 0);
        return 'alive';
      } catch {
        return 'gone';
      }
    }, { timeout: 10_000 })
    .toBe('gone');
});

test('WSL not installed: the app still works and says so', async () => {
  const { launch } = await import('./fixtures');
  const f = await launch({ ARCTRI_FAKE_WSL: 'missing' });
  try {
    await waitForEditor(f.page);
    await f.page.getByRole('button', { name: /new tab/i }).nth(1).click();
    await expect(f.page.getByText('WSL is not installed')).toBeVisible();
    await expect(f.page.getByRole('menuitem', { name: /Ubuntu/ })).toHaveCount(0);
    await f.page.keyboard.press('Escape');
    await activeEditor(f.page).fill('echo works-without-wsl');
    await activeEditor(f.page).press('Enter');
    await settled(f.page, 1);
    await expect(activeBlocks(f.page).first()).toContainText('works-without-wsl');
  } finally {
    await f.app.close();
  }
});
