import { activeBlocks, activeEditor, expect, runCommand, settled, test, waitForEditor } from './fixtures';
import { activeId, waitScreen } from './helpers';

const blocks = activeBlocks;
const run = runCommand;

test.describe('command blocks (PowerShell 7)', () => {
  test('exit codes, status, collapse, copy and rerun', async ({ ad }) => {
    const { page, app } = ad;
    await waitForEditor(page);
    await run(page, 'cmd /c exit 3');
    await settled(page, 1);
    await expect(blocks(page).first()).toContainText('exit 3');

    await run(page, 'Write-Output "line one"; Write-Output "line two"');
    await settled(page, 2);
    const second = blocks(page).nth(1);
    await expect(second).toContainText('line two');

    // collapse hides the output, expand shows it again
    await second.getByRole('button', { name: /collapse/i }).click();
    await expect(second.locator('.block-output')).toHaveCount(0);
    await second.getByRole('button', { name: /expand/i }).click();
    await expect(second.locator('.block-output')).toContainText('line two');

    // copy command and copy output
    await second.hover();
    await second.getByRole('button', { name: /copy command/i }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Write-Output "line one"; Write-Output "line two"');
    await second.getByRole('button', { name: /copy output/i }).click();
    // the Windows clipboard stores line breaks as CRLF
    expect((await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe('line one\nline two');

    // rerun creates a fresh block with the same command
    await second.hover();
    await second.getByRole('button', { name: /run again/i }).click();
    await settled(page, 3);
    await expect(blocks(page).nth(2).locator('.block-output')).toContainText('line two');
  });

  test('keyboard navigation between blocks', async ({ ad }) => {
    const { page } = ad;
    await waitForEditor(page);
    for (const [i, c] of ['echo a1', 'echo b2', 'echo c3'].entries()) {
      await run(page, c);
      await settled(page, i + 1);
    }
    await page.keyboard.press('Control+ArrowUp');
    await page.keyboard.press('Control+ArrowUp');
    await expect(blocks(page).nth(1)).toHaveClass(/border-accent/);
    await page.keyboard.press('Control+ArrowDown');
    await expect(blocks(page).nth(2)).toHaveClass(/border-accent/);
  });

  test('multi-line input, Thai text and long output', async ({ ad }) => {
    const { page } = ad;
    await waitForEditor(page);
    const editor = activeEditor(page);
    await editor.fill('Write-Output "สวัสดี น้ำ ผู้ใหญ่"');
    await editor.press('Enter');
    await settled(page, 1);
    await expect(blocks(page).first()).toContainText('สวัสดี น้ำ ผู้ใหญ่');

    await run(page, '1..20000 | % { "row $_" }');
    await settled(page, 2, 60_000);
    await expect(blocks(page).nth(1)).toContainText('row 1');
    // the UI stays responsive: a new command still runs promptly afterwards
    const t0 = Date.now();
    await run(page, 'echo after-big');
    await settled(page, 3, 15_000);
    await expect(blocks(page).nth(2)).toContainText('after-big');
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  test('interrupting a long-running command with Stop', async ({ ad }) => {
    const { page } = ad;
    await waitForEditor(page);
    await run(page, 'Start-Sleep 60');
    await expect(page.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /stop/i }).click();
    await settled(page, 1, 20_000);
  });
});

test.describe('command blocks (WSL bash)', () => {
  test('opens from the menu, runs commands and shows a full-screen program', async ({ ad }) => {
    const { page } = ad;
    await page.getByRole('button', { name: /new tab/i }).nth(1).click();
    await page.getByRole('menuitem', { name: /Ubuntu · bash/ }).first().click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await waitForEditor(page, 60_000);
    await run(page, 'echo from-wsl && uname -s');
    await settled(page, 1);
    await expect(blocks(page).first()).toContainText('from-wsl');
    await expect(blocks(page).first()).toContainText('Linux');

    await run(page, 'less /etc/os-release');
    // the live terminal takes over while a full-screen program runs
    await waitScreen(page, 'NAME=', 20_000);
    await page.keyboard.press('q');
    await settled(page, 2, 20_000);
    await expect(blocks(page).nth(1)).toContainText(/interactive program/i);
    expect(await activeId(page)).toBeTruthy();
  });
});
