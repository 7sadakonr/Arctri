import { expect, test } from '@playwright/test';
import { expectNewTabSelected, launch, waitForEditor } from './fixtures';

// zsh pads its prompt line with spaces out to the window width. That used to leave the input box no room at all:
// no caret, nothing could be typed. Only WSL tabs were affected.
test('a zsh tab (WSL) accepts typing: the prompt leaves room for the input', async () => {
  test.setTimeout(240_000);
  const f = await launch({});
  const { page } = f;
  try {
    await waitForEditor(page, 60_000);
    await page.getByRole('menubar').getByRole('button', { name: 'Terminal' }).click();
    await page.getByRole('menuitem', { name: /New Terminal with Profile/ }).click();
    await page.getByRole('menuitem', { name: /Ubuntu · zsh/ }).click();
    await expectNewTabSelected(page, 2);
    await waitForEditor(page, 90_000);
    const editor = page.locator('[data-active="true"] [data-testid="command-editor"]');
    await expect.poll(async () => (await editor.boundingBox())?.width ?? 0, { timeout: 20_000 }).toBeGreaterThan(200);
    await page.keyboard.type('echo hello-zsh');
    await expect(editor).toHaveValue('echo hello-zsh');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-active="true"] [data-block-id]').filter({ hasText: 'hello-zsh' }).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await f.app.close().catch(() => undefined);
  }
});
