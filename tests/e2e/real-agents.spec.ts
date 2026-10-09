// Opt-in: drives the real Claude Code and Codex CLIs that are installed on this machine.
// It never sends a prompt (no Enter in the agent) so it uses no model quota and needs no login.
//   set AGENTDOCK_REAL_AGENTS=1 && npx playwright test tests/e2e/real-agents.spec.ts
import { expect, launch, test, waitForEditor } from './fixtures';
import { screen, waitScreen } from './helpers';

test.skip(!process.env['AGENTDOCK_REAL_AGENTS'], 'set AGENTDOCK_REAL_AGENTS=1 to run');

const CASES: Array<[string, RegExp, RegExp]> = [
  ['Claude Code in Ubuntu', /Claude Code|claude|Welcome|trust|theme|login/i, /Claude/i],
  ['Codex in Ubuntu', /Codex|OpenAI|Sign in|trust|approval|model/i, /Codex/i],
  ['Codex in Windows', /Codex|OpenAI|Sign in|trust|approval|model/i, /Codex/i]
];

for (const [menuName, screenRe] of CASES.map(([m, s]) => [m, s] as const)) {
  test(`real agent TUI: ${menuName}`, async () => {
    const f = await launch();
    const { page } = f;
    try {
      await waitForEditor(page);
      await page.getByRole('button', { name: /new tab/i }).nth(1).click();
      const item = page.getByRole('menuitem', { name: new RegExp(menuName) });
      // detection of agents runs when the menu opens and takes a while (it starts login shells in WSL)
      await item.waitFor({ state: 'visible', timeout: 60_000 });
      await expect(item).not.toContainText('Not installed', { timeout: 60_000 }).catch(() => test.skip(true, `${menuName} is not installed here`));
      await item.click();
      const text = await waitScreen(page, screenRe, 60_000);
      await page.screenshot({ path: `test-results/agent-${menuName.replace(/\W+/g, '-')}.png` });

      // keys reach the TUI: type Thai and English, then delete it again, never pressing Enter
      await page.keyboard.insertText('สวัสดี test');
      await page.waitForTimeout(800);
      const typed = await screen(page);
      console.log(`REAL ${menuName}: TUI drew ${text.length} chars; typed text visible = ${typed.includes('สวัสดี')}`);
      await page.keyboard.press('Escape');
      for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace');
      await page.screenshot({ path: `test-results/agent-${menuName.replace(/\W+/g, '-')}-typed.png` });

      // the window can be resized while the TUI is running
      await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1000, 620));
      await page.waitForTimeout(1200);
      await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1300, 800));
      await page.waitForTimeout(1200);

      // still running, and Ctrl+C twice ends it cleanly
      await expect(page.locator('[data-active="true"]').getByText(/running/i)).toBeVisible();
      await page.keyboard.press('Control+c');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+c');
      await expect(page.locator('[data-active="true"]').getByText(/exited/i)).toBeVisible({ timeout: 30_000 });
    } finally {
      await f.app.close();
    }
  });
}
