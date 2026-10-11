import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { active, activeBlocks, launch, waitForEditor } from './fixtures';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });

/** A repository with two branches: main (one commit, one uncommitted change) and feat (one more commit). */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arctri-sidebar-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'Tester');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'first commit');
  git(dir, 'switch', '-c', 'feat');
  writeFileSync(join(dir, 'b.txt'), 'bee\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'second: add b');
  git(dir, 'switch', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  return dir;
}

test('sidebar: open from the start, with Files, Changes, Branches and History', async () => {
  const repo = makeRepo();
  const data = mkdtempSync(join(tmpdir(), 'arctri-e2e-'));
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'preferences.json'), JSON.stringify({ prefs: { defaultProfile: 'pwsh' } }));
  const f = await launch({ ARCTRI_E2E_WELCOME: '1', ARCTRI_E2E_PICK: JSON.stringify([repo]) }, data);
  const { page } = f;
  try {
    await page.getByRole('menubar').getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /Open Folder/ }).click();
    await waitForEditor(page);

    // open by default, on the file tree
    const panel = active(page).getByTestId('file-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('treeitem', { name: /a\.txt/ })).toBeVisible();

    // Changes: the edited file, a click shows its diff beside the terminal
    await panel.getByRole('button', { name: 'Changes' }).click();
    const changed = panel.locator('[data-path="a.txt"]');
    await expect(changed).toBeVisible({ timeout: 20_000 });
    await changed.click();
    await expect(active(page).getByTestId('file-viewer')).toBeVisible();

    // Branches: the current branch is marked; clicking another types `git switch` into the terminal
    await panel.getByRole('button', { name: 'Branches' }).click();
    await expect(panel.locator('[data-branch="main"]')).toBeDisabled({ timeout: 20_000 });
    await panel.locator('[data-branch="feat"]').click();
    await expect(activeBlocks(page).filter({ hasText: 'git switch feat' })).toHaveCount(1, { timeout: 20_000 });
    await expect(panel.locator('[data-branch="feat"]')).toBeDisabled({ timeout: 20_000 });

    // History: commits of the branch; a commit lists its files and a file opens as a diff of that commit
    await panel.getByRole('button', { name: 'History' }).click();
    const commit = panel.locator('[data-commit]').filter({ hasText: 'second: add b' });
    await expect(commit).toBeVisible({ timeout: 20_000 });
    await commit.getByRole('button').first().click();
    await commit.getByRole('button', { name: /b\.txt/ }).click();
    const viewer = active(page).getByTestId('file-viewer');
    await expect(viewer.getByRole('tab', { name: /b\.txt @/ })).toBeVisible({ timeout: 20_000 });

    // Ctrl+Shift+E hides it and brings it back
    await page.keyboard.press('Control+Shift+E');
    await expect(panel).toHaveCount(0);
    await page.keyboard.press('Control+Shift+E');
    await expect(active(page).getByTestId('file-panel')).toBeVisible();
  } finally {
    await f.app.close().catch(() => undefined);
  }
});
