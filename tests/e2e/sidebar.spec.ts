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

    // Branches: switching with uncommitted edits requires confirmation and leaves the terminal alone.
    await panel.getByRole('button', { name: 'Branches' }).click();
    await expect(panel.locator('[data-branch="main"]')).toHaveAttribute('aria-current', 'true', { timeout: 20_000 });
    page.once('dialog', (d) => void d.accept());
    await panel.locator('[data-branch="feat"]').click();
    // switched at once through git: nothing is typed into the terminal
    await expect(page.getByTestId('location-branch')).toContainText('feat', { timeout: 20_000 });
    await expect(activeBlocks(page).filter({ hasText: 'git switch' })).toHaveCount(0);
    await expect(panel.locator('[data-branch="feat"]')).toHaveAttribute('aria-current', 'true', { timeout: 20_000 });

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

test('source control: stage a file, commit with a Thai message, publish, create a branch and push it', async () => {
  const remote = mkdtempSync(join(tmpdir(), 'arctri-remote-'));
  git(remote, 'init', '--bare', '-b', 'main');
  const repo = mkdtempSync(join(tmpdir(), 'arctri-sc-'));
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'Tester');
  git(repo, 'remote', 'add', 'origin', remote);
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'first commit');
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(repo, 'c.txt'), 'new\n');

  const data = mkdtempSync(join(tmpdir(), 'arctri-e2e-'));
  writeFileSync(join(data, 'preferences.json'), JSON.stringify({ prefs: { defaultProfile: 'pwsh' } }));
  const f = await launch({ ARCTRI_E2E_WELCOME: '1', ARCTRI_E2E_PICK: JSON.stringify([repo]) }, data);
  const { page } = f;
  const remoteBranches = () => git(remote, 'branch', '--list').toString().replace(/[\s*]/g, ' ').trim().split(/\s+/).sort();
  try {
    await page.getByRole('menubar').getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /Open Folder/ }).click();
    await waitForEditor(page);
    const panel = active(page).getByTestId('file-panel');
    await panel.getByRole('button', { name: 'Changes' }).click();

    // one list with a checkbox per file, as in Zed; plain words say what happened to each file
    const fileA = panel.locator('[data-path="a.txt"]');
    const fileC = panel.locator('[data-path="c.txt"]');
    await expect(fileA).toContainText('Edited', { timeout: 30_000 });
    await expect(fileC).toContainText('New file');
    await expect(fileA).toHaveAttribute('data-ticked', 'false');
    await expect(panel.getByTestId('commit-help')).toContainText('Tick the files to include in the commit');
    const commit = panel.getByTestId('commit-button');
    await panel.getByTestId('commit-message').fill('x');
    await expect(commit).toBeDisabled(); // a message but no ticked file
    await panel.getByTestId('commit-message').fill('');
    await fileA.getByTestId('file-tick').check({ timeout: 30_000 });
    await expect(fileA).toHaveAttribute('data-ticked', 'true', { timeout: 20_000 });
    await expect(fileC).toHaveAttribute('data-ticked', 'false');
    await expect(panel.getByTestId('commit-help')).toContainText('Files ready to commit: 1');
    await expect(commit).toBeDisabled(); // a ticked file but no message
    await expect(commit).toHaveText('Commit (1)');
    const message = 'เพิ่มบรรทัดที่สอง\n\nรายละเอียด "quoted" $HOME';
    await panel.getByTestId('commit-message').fill(message);
    await commit.click();
    await expect(fileA).toHaveCount(0, { timeout: 30_000 });
    expect(git(repo, 'log', '-1', '--format=%B').toString().trim()).toBe(message);
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').toString().trim()).toBe('a.txt');
    await expect(fileC).toBeVisible();

    // main has no upstream yet: the button next to the branch name says Publish and uploads it
    await expect(panel.getByTestId('branch-name')).toContainText('main');
    const publish = panel.getByTestId('remote-primary');
    await expect(publish).toHaveText(/Publish/, { timeout: 20_000 });
    await publish.click();
    await expect.poll(remoteBranches, { timeout: 30_000 }).toContain('main');
    // once uploaded and in sync, the same button offers Fetch
    await expect(panel.getByTestId('remote-primary')).toHaveText(/Fetch/, { timeout: 20_000 });

    // a new branch from the Branches view becomes the current one (also in the title bar) and can be pushed
    await panel.getByRole('button', { name: 'Branches' }).click();
    await panel.getByTestId('new-branch').click();
    await page.getByTestId('new-branch-name').fill('bad name');
    await expect(page.getByText(/not a valid branch name/i)).toBeVisible();
    await page.getByTestId('new-branch-name').fill('feature/x');
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('new-branch-name').press('Enter');
    await expect(panel.locator('[data-branch="feature/x"]')).toHaveAttribute('aria-current', 'true', { timeout: 20_000 });
    await expect(page.getByTestId('location-branch')).toContainText('feature/x', { timeout: 20_000 });
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').toString().trim()).toBe('feature/x');
    await panel.getByTestId('branch-push').click();
    await expect.poll(remoteBranches, { timeout: 30_000 }).toContain('feature/x');
    // git records the upstream just after the server has the branch
    await expect
      .poll(() => { try { return git(repo, 'rev-parse', '--abbrev-ref', '@{u}').toString().trim(); } catch { return ''; } }, { timeout: 20_000 })
      .toBe('origin/feature/x');
  } finally {
    await f.app.close().catch(() => undefined);
  }
});
