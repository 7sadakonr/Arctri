import { active, activeBlocks, expect, test, waitForEditor } from './fixtures';
import { waitScreen } from './helpers';

test('classic tab: plain terminal with command tracking, no editor, no block list', async ({ ad }) => {
  const { page, app } = ad;
  await waitForEditor(page);
  await page.getByRole('button', { name: /new tab/i }).nth(1).click();
  await page.getByRole('menuitem', { name: /Windows PowerShell/ }).getByRole('button', { name: /classic/i }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await waitScreen(page, 'PS ', 30_000);

  // no command editor and no block list: the shell's own prompt is used
  await expect(active(page).getByTestId('command-editor')).toHaveCount(0);
  await expect(activeBlocks(page)).toHaveCount(0);

  await page.keyboard.type('echo classic-works');
  await page.keyboard.press('Enter');
  await waitScreen(page, /classic-works\s*\n.*PS /s);

  // finished commands are still tracked: the bar offers copy and run again
  const bar = active(page);
  await expect(bar.getByRole('button', { name: /copy last command/i })).toBeVisible({ timeout: 15_000 });
  await bar.getByRole('button', { name: /copy last command/i }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('echo classic-works');
  await bar.getByRole('button', { name: /copy last output/i }).click();
  expect((await app.evaluate(({ clipboard }) => clipboard.readText())).trim()).toBe('classic-works');
  await bar.getByRole('button', { name: /run last command again/i }).click();
  await expect.poll(async () => ((await (await import('./helpers')).screen(page)).match(/classic-works/g) ?? []).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
});
