// Opt-in: drives the real Claude Code and Codex CLIs that are installed on this machine.
// It never sends a prompt (no Enter in the agent) so it uses no model quota and needs no login.
//   set ARCTRI_REAL_AGENTS=1 && npx playwright test tests/e2e/real-agents.spec.ts
import { expect, launch, test, waitForEditor } from './fixtures';
import { screen, waitScreen } from './helpers';

test.skip(!process.env['ARCTRI_REAL_AGENTS'], 'set ARCTRI_REAL_AGENTS=1 to run');

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

// The case from real use: an agent started by typing its name in a WSL shell tab.
for (const agent of ['claude', 'codex']) {
  test(`real ${agent} typed in a WSL zsh tab: bar switches, first rows are not covered`, async () => {
    const f = await launch();
    const { page } = f;
    try {
      await waitForEditor(page);
      await page.getByRole('button', { name: /new tab/i }).nth(1).click();
      const item = page.getByRole('menuitem', { name: /Ubuntu · zsh/ });
      await item.waitFor({ state: 'visible', timeout: 60_000 });
      await item.first().click();
      await expect(page.getByRole('tab')).toHaveCount(2);
      await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
      await waitForEditor(page, 60_000);
      const editor = page.locator('[data-active="true"]').getByTestId('command-editor');
      await editor.fill(agent);
      await editor.press('Enter');
      const bar = page.locator('[data-active="true"]').getByTestId('agent-bar');
      await expect(bar).toHaveAttribute('data-agent', agent === 'claude' ? 'claude-code' : 'codex', { timeout: 30_000 });
      await waitScreen(page, agent === 'claude' ? /Claude Code|trust|Welcome/i : /Codex|OpenAI|Sign in|trust|model/i, 60_000);
      const barBox = (await page.locator('[data-active="true"]').getByTestId('running-bar').boundingBox())!;
      const screenBox = (await page.locator('[data-active="true"]').locator('.xterm-screen').boundingBox())!;
      expect(screenBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
      await page.screenshot({ path: `test-results/real-${agent}-in-zsh.png` });
      // Claude's trust dialog is left with Esc; Codex ends on Ctrl+C
      await page.keyboard.press(agent === 'claude' ? 'Escape' : 'Control+c');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+c');
      await expect(page.locator('[data-active="true"]').getByTestId('agent-bar')).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await f.app.close();
    }
  });
}
