import { expect, launchWithFakeAgent, waitForEditor } from './fixtures';
import { test as base } from '@playwright/test';
import { waitScreen } from './helpers';

const test = base;

test('a hidden tab never paints over the active one (agent running in tab 1, new shell in tab 2)', async () => {
  const { app, page } = await launchWithFakeAgent();
  try {
    await waitForEditor(page);
    await page.getByRole('button', { name: /new tab/i }).nth(1).click();
    await page.getByRole('menuitem', { name: /Codex in Windows/ }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await waitScreen(page, 'FAKE-AGENT ready', 30_000);

    await page.keyboard.press('Control+Shift+T');
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByRole('tab').nth(2)).toHaveAttribute('aria-selected', 'true');

    const owner = () =>
      page.evaluate(() => {
        const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        const root = el?.closest('[data-session]') as HTMLElement | null;
        return { active: root?.dataset['active'], hiddenAttr: root?.getAttribute('aria-hidden') };
      });

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Control+2'); // the agent tab
      await expect.poll(owner).toMatchObject({ active: 'true' });
      await page.keyboard.press('Control+3'); // the new shell tab
      await expect.poll(owner).toMatchObject({ active: 'true', hiddenAttr: 'false' });
    }
    // every session root that is not the active one is hidden from users and from hit testing
    const hiddenOk = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-session][data-active="false"]')].every((r) => getComputedStyle(r).visibility === 'hidden')
    );
    expect(hiddenOk).toBe(true);
    // and no terminal element inside them is forced visible
    const leaked = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-session][data-active="false"] *')].filter((e) => getComputedStyle(e).visibility === 'visible').length
    );
    expect(leaked).toBe(0);
  } finally {
    await app.close();
  }
});
