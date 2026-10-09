import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeBlocks, activeEditor, expect, expectNewTabSelected, runCommand, settled, test, waitForEditor, active } from './fixtures';
import { waitScreen } from './helpers';

const options = (page: import('@playwright/test').Page) => active(page).getByRole('option');

test('git completion: dropdown, navigation, Tab accepts, Esc dismisses, nothing is executed', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  const editor = activeEditor(page);
  await editor.pressSequentially('git ch');
  await expect(options(page).filter({ hasText: 'checkout' })).toBeVisible({ timeout: 10_000 });
  await editor.press('Tab');
  await expect(editor).toHaveValue('git checkout ');

  await editor.fill('git ch');
  await expect(options(page).first()).toBeVisible();
  await editor.press('Escape');
  await expect(options(page)).toHaveCount(0);
  await expect(editor).toHaveValue('git ch');
  // suggestions were only inserted into the editor: no command ran
  await expect(activeBlocks(page)).toHaveCount(0);
});

test('history suggestions and inline ghost text', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await runCommand(page, 'echo zzz-history-marker');
  await settled(page, 1);
  const editor = activeEditor(page);
  await editor.pressSequentially('echo zzz-hi');
  await expect(options(page).filter({ hasText: 'echo zzz-history-marker' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600); // let the results of the last keystroke arrive before navigating them
  // ArrowDown selects, Enter then accepts the selected suggestion instead of running the line
  await editor.press('ArrowDown');
  await editor.press('Enter');
  await expect(editor).toHaveValue('echo zzz-history-marker');
  await expect(activeBlocks(page)).toHaveCount(1);
});

test('paths with spaces and Thai names are quoted for PowerShell', async ({ ad }) => {
  const { page } = ad;
  const root = mkdtempSync(join(tmpdir(), 'ad ac '));
  mkdirSync(join(root, 'my dir'));
  mkdirSync(join(root, 'โฟลเดอร์ ไทย'));
  writeFileSync(join(root, 'my dir', 'inner file.txt'), 'x');
  await waitForEditor(page);
  await runCommand(page, `Set-Location -LiteralPath '${root}'`);
  await settled(page, 1);
  const editor = activeEditor(page);
  await editor.pressSequentially('cd my');
  await expect(options(page).filter({ hasText: 'my dir' })).toBeVisible({ timeout: 10_000 });
  await editor.press('Tab');
  await expect(editor).toHaveValue("cd 'my dir\\'");
  await editor.fill('cd โฟ');
  await expect(options(page).first()).toContainText('โฟลเดอร์ ไทย');
  await editor.press('Tab');
  await expect(editor).toHaveValue("cd 'โฟลเดอร์ ไทย\\'");
});

test('WSL sessions get Linux commands and paths', async ({ ad }) => {
  const { page } = ad;
  await page.getByRole('button', { name: /new tab/i }).nth(1).click();
  await page.getByRole('menuitem', { name: /Ubuntu · bash/ }).first().click();
  await expectNewTabSelected(page, 2);
  await waitForEditor(page, 60_000);
  const editor = activeEditor(page);
  await editor.pressSequentially('cd /us');
  await expect(options(page).filter({ hasText: 'usr/' })).toBeVisible({ timeout: 15_000 });
  await editor.press('Tab');
  await expect(editor).toHaveValue('cd /usr/');
  await editor.fill('Get-Chi');
  await page.waitForTimeout(600);
  await expect(options(page).filter({ hasText: 'Get-ChildItem' })).toHaveCount(0);
  await editor.fill('ech');
  await expect(options(page).filter({ hasText: /^echo/ }).first()).toBeVisible({ timeout: 10_000 });
});

test('keys go straight to a running program, including Thai text', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await runCommand(page, `$x = Read-Host 'name'; "got:$x"`);
  await waitScreen(page, 'name:');
  await page.keyboard.insertText('สวัสดี น้ำ');
  await page.keyboard.press('Enter');
  await settled(page, 1);
  await expect(activeBlocks(page).first().locator('.block-output')).toContainText('got:สวัสดี น้ำ');
});
