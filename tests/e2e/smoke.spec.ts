import { activeBlocks, activeEditor, expect, test, waitForEditor } from './fixtures';

test('starts, opens a shell tab and runs a command as a block', async ({ ad }) => {
  const { page } = ad;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 30_000 });
  await waitForEditor(page);
  const editor = activeEditor(page);
  await editor.fill('echo hello-from-e2e');
  await editor.press('Enter');
  await expect(activeBlocks(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(activeBlocks(page).first()).toContainText('hello-from-e2e');
  await page.screenshot({ path: 'test-results/smoke.png' });
  expect(errors).toEqual([]);
});
