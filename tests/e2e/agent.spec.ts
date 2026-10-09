import { active, expect, launchWithFakeAgent, waitForEditor } from './fixtures';
import { test as base } from '@playwright/test';
import { screen, waitScreen } from './helpers';

const test = base;

async function openFakeAgent(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /new tab/i }).nth(1).click();
  await page.getByRole('menuitem', { name: /Codex in Windows/ }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await waitScreen(page, 'FAKE-AGENT ready', 30_000);
}

test('agent session: native TUI, input, paste, composer, commands, approval prompt, exit and restart', async () => {
  const { app, page } = await launchWithFakeAgent();
  try {
    await waitForEditor(page);
    await openFakeAgent(page);

    // identity is shown, and only controls that can work are offered
    const bar = active(page);
    await expect(page.getByRole('tab').nth(1)).toContainText('Codex · Windows');
    await expect(bar.getByTestId('agent-bar')).toHaveAttribute('data-agent', 'codex');
    await expect(bar.getByText(/running/i)).toBeVisible();

    // native keyboard input, including Thai
    await page.keyboard.type('hello');
    await waitScreen(page, 'input: hello');
    await page.keyboard.press('Backspace');
    await waitScreen(page, 'input: hell\n');
    await page.keyboard.insertText(' สวัสดี');
    await waitScreen(page, 'input: hell สวัสดี');

    // the approval prompt is never answered by Arctri
    await page.waitForTimeout(1500);
    expect(await screen(page)).toContain('approval> Allow command? (y/n)');
    expect(await screen(page)).not.toMatch(/submitted:/);

    // Rich Input pastes multi-line text; Enter inside it is the user's own "send"
    await bar.getByRole('button', { name: /^Rich Input/ }).click();
    await bar.getByTestId('rich-input').getByRole('textbox').fill('line1\nบรรทัด2');
    await bar.getByTestId('rich-input').getByRole('textbox').press('Enter');
    await waitScreen(page, /paste: line1⏎บรรทัด2[\s\S]*note: submitted:/);

    // native commands are sent as typed text and are labelled as such
    await bar.getByRole('button', { name: '/', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /\/model/ })).toContainText('Sends "/model" to Codex');
    await page.getByRole('menuitem', { name: /\/model/ }).click();
    await waitScreen(page, /submitted:.*\/model/);

    // resize reaches the program
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1000, 600));
    await waitScreen(page, /size=(\d+)x(\d+)/);
    const before = /size=(\d+)x/.exec(await screen(page))![1];
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 800));
    await expect.poll(async () => /size=(\d+)x/.exec(await screen(page))![1]).not.toBe(before);

    // Ctrl+C ends the agent: the tab says so and offers Restart
    await page.keyboard.press('Control+c');
    await expect(bar.getByText(/exited/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/The process ended/)).toBeVisible();
    await bar.getByRole('button', { name: /restart/i }).first().click();
    await waitScreen(page, 'FAKE-AGENT ready', 30_000);
    await expect(page.getByRole('tab')).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test('agents that are missing are shown as not installed, and the shell tabs keep working', async () => {
  const { app, page } = await launchWithFakeAgent();
  try {
    await waitForEditor(page);
    await page.getByRole('button', { name: /new tab/i }).nth(1).click();
    const claudeWin = page.getByRole('menuitem', { name: /Claude Code in Windows/ });
    await expect(claudeWin).toContainText('Not installed', { timeout: 30_000 });
    await page.keyboard.press('Escape');
    await waitForEditor(page);
  } finally {
    await app.close();
  }
});

test('resume opens the agent with its resume subcommand (agent installed as an npm-style .cmd shim)', async () => {
  const { app, page } = await launchWithFakeAgent('cmd');
  try {
    await waitForEditor(page);
    await openFakeAgent(page);
    await active(page).getByRole('button', { name: /resume last/i }).click();
    await expect(page.getByRole('tab')).toHaveCount(3);
    await waitScreen(page, 'args=[resume --last]', 30_000);
  } finally {
    await app.close();
  }
});
