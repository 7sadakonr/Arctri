import { launch, expect, test, activeEditor, waitForEditor } from './fixtures';

test('quitting with running work asks in the app: Cancel keeps it, Quit ends it', async () => {
  // end-to-end runs normally skip the question; this switches it back on
  const f = await launch({ ARCTRI_E2E_ASK_QUIT: '1' });
  const { app, page } = f;
  await waitForEditor(page);
  await activeEditor(page).fill('sleep 60');
  await activeEditor(page).press('Enter');
  await expect(page.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 15_000 });

  void app.evaluate(({ app: a }) => a.quit());
  await expect(page.getByTestId('quit-dialog')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('quit-dialog')).toContainText('1 tab(s) still running');
  await page.getByTestId('quit-cancel').click();
  await expect(page.getByTestId('quit-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /stop/i })).toBeVisible(); // still running

  // asking twice shows one prompt
  void app.evaluate(({ app: a }) => a.quit());
  void app.evaluate(({ app: a }) => a.quit());
  await expect(page.getByTestId('quit-dialog')).toHaveCount(1);
  const closed = new Promise<void>((r) => app.process().once('exit', () => r()));
  await page.getByTestId('quit-confirm').click();
  await closed;
});

test('settings: the sound switch and the test button', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Meta+,');
  await page.keyboard.press('Control+,');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Test' }).click();
  expect(await page.evaluate(() => (window as unknown as { __arctriSounds?: Array<{ kind: string }> }).__arctriSounds?.map((x) => x.kind))).toEqual(['done']);
});
