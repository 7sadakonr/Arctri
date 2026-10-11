import { expect, test } from '@playwright/test';
import { launch } from './fixtures';

test('menu bar: menus switch on hover, File opens Settings and a new terminal, tabs sit on their own row', async () => {
  const f = await launch({ ARCTRI_E2E_WELCOME: '1' });
  const { page } = f;
  try {
    const menubar = page.getByRole('menubar');
    await expect(menubar.getByRole('button')).toHaveText(['File', 'Edit', 'View', 'Terminal', 'Help']);
    // the home page has no tab row
    await expect(page.getByRole('tablist')).toHaveCount(0);

    // Terminal > New Terminal opens a tab, which brings the tab row
    await menubar.getByRole('button', { name: 'Terminal' }).click();
    await page.getByRole('menuitem', { name: /New Terminal/ }).first().click();
    await expect(page.locator('[data-session]')).toHaveCount(1);
    await expect(page.getByRole('tablist')).toBeVisible();
    const menuBox = await menubar.boundingBox();
    const tabsBox = await page.getByRole('tablist').boundingBox();
    expect(tabsBox!.y).toBeGreaterThan(menuBox!.y + menuBox!.height - 2);

    // the folder is in the middle of the title bar; nothing is left under the command editor
    await expect(page.getByTestId('location-path')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /native prompt|classic/i })).toHaveCount(0);
    const chip = await page.getByTestId('location-path').boundingBox();
    expect(chip!.y + chip!.height).toBeLessThanOrEqual(tabsBox!.y + 2); // in the title bar, above the tab row

    // with one menu open, moving over another switches to it
    await menubar.getByRole('button', { name: 'File' }).click();
    await expect(page.getByRole('menuitem', { name: /Open Folder/ })).toBeVisible();
    await menubar.getByRole('button', { name: 'View' }).hover();
    await expect(page.getByRole('menuitem', { name: /Zoom In/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Open Folder/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // File > Settings
    await menubar.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /^Settings/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } finally {
    await f.app.close().catch(() => undefined);
  }
});
