import { expect, test, waitForEditor } from './fixtures';

// Closing a tab must never show it again, not even for a moment ("The process ended (code 1)" flashing up).
test('a closed tab does not come back for a moment', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  // the shell from the report: zsh in WSL (killing it ends with a non-zero code)
  await page.getByRole('button', { name: /new tab/i }).last().click();
  await page.getByRole('menuitem', { name: /zsh/ }).first().click();
  await expect(page.locator('[data-session]')).toHaveCount(2);
  await waitForEditor(page, 60_000);

  await page.evaluate(() => {
    const w = window as unknown as { __seen: { max: number; ended: boolean } };
    w.__seen = { max: 0, ended: false };
    const look = () => {
      w.__seen.max = Math.max(w.__seen.max, document.querySelectorAll('[data-session]').length);
      if (/process ended|เซสชัน.*สิ้นสุด/i.test(document.body.innerText)) w.__seen.ended = true;
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  // the other tab goes first: the one in question is then the last, and a ghost of it would take the whole window
  await page.keyboard.press('Control+1');
  await page.keyboard.press('Control+Shift+W');
  await expect(page.locator('[data-session]')).toHaveCount(1);
  await page.evaluate(() => ((window as unknown as { __seen: { max: number } }).__seen.max = 0));
  await page.keyboard.press('Control+Shift+W');
  await expect(page.locator('[data-session]')).toHaveCount(0);
  await page.waitForTimeout(4000);
  const seen = await page.evaluate(() => (window as unknown as { __seen: { max: number; ended: boolean } }).__seen);
  expect(seen.ended).toBe(false);
  expect(seen.max).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-session]')).toHaveCount(0);
});
