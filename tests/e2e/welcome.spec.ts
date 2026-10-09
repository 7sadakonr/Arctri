import { expect, test } from '@playwright/test';
import { launch } from './fixtures';

test('without saved tabs the app opens on the welcome page, not a terminal', async () => {
  const f = await launch({ ARCTRI_E2E_WELCOME: '1' });
  try {
    await expect(f.page.getByText(/open project/i)).toBeVisible();
    await expect(f.page.locator('[data-session]')).toHaveCount(0);
    await f.page.getByRole('button', { name: /new terminal/i }).click();
    await expect(f.page.locator('[data-session]')).toHaveCount(1);
  } finally {
    await f.app.close().catch(() => undefined);
  }
});
