import type { Page } from '@playwright/test';

export const screen = (page: Page, id?: string) =>
  page.evaluate((i) => (window as unknown as { __agentdockTest: { screen(id?: string): string } }).__agentdockTest.screen(i), id);

export const activeId = (page: Page) =>
  page.evaluate(() => (window as unknown as { __agentdockTest: { activeId(): string } }).__agentdockTest.activeId());

export async function waitScreen(page: Page, text: string | RegExp, timeout = 20_000, id?: string): Promise<string> {
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    last = await screen(page, id);
    if (typeof text === 'string' ? last.includes(text) : text.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`screen never contained ${String(text)}; last screen:\n${last.slice(-1500)}`);
}
