import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { active, launch, waitForEditor } from './fixtures';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Tester', ...args], { cwd, stdio: 'pipe' }).toString();

/** A server with one commit, the clone Arctri opens, and a second clone standing for a colleague. */
function makeClones() {
  const root = mkdtempSync(join(tmpdir(), 'arctri-sync-e2e-'));
  const remote = join(root, 'remote.git');
  git(root, 'init', '--bare', '-b', 'main', remote);
  const mine = join(root, 'mine');
  git(root, 'clone', '-q', remote, mine);
  writeFileSync(join(mine, 'a.txt'), 'one\n');
  git(mine, 'add', '.');
  git(mine, 'commit', '-m', 'first');
  git(mine, 'branch', '-M', 'main');
  git(mine, 'push', '-q', '-u', 'origin', 'main');
  const theirs = join(root, 'theirs');
  git(root, 'clone', '-q', remote, theirs);
  return { mine, theirs };
}

test('git sync: sees new commits without touching files, updates by fast-forward, follows a switch made elsewhere', async () => {
  const { mine, theirs } = makeClones();
  const data = mkdtempSync(join(tmpdir(), 'arctri-e2e-'));
  writeFileSync(join(data, 'preferences.json'), JSON.stringify({ prefs: { defaultProfile: 'pwsh' } }));
  const f = await launch({ ARCTRI_E2E_WELCOME: '1', ARCTRI_E2E_PICK: JSON.stringify([mine]) }, data);
  const { page } = f;
  try {
    await page.getByRole('menubar').getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /Open Folder/ }).click();
    await waitForEditor(page);
    const panel = active(page).getByTestId('file-panel');
    await panel.getByRole('button', { name: 'Changes' }).click();
    const status = panel.getByTestId('git-sync-status');
    await expect(status).toHaveAttribute('data-status', 'up-to-date', { timeout: 30_000 });

    // a colleague pushes two commits: found by the next fetch, nothing changes on disk
    writeFileSync(join(theirs, 'b.txt'), 'bee\n');
    git(theirs, 'add', '.');
    git(theirs, 'commit', '-m', 'second');
    writeFileSync(join(theirs, 'c.txt'), 'sea\n');
    git(theirs, 'add', '.');
    git(theirs, 'commit', '-m', 'third');
    git(theirs, 'push', '-q');
    await panel.getByTestId('remote-primary').click(); // Fetch
    await expect(status).toHaveAttribute('data-status', 'behind', { timeout: 30_000 });
    expect(existsSync(join(mine, 'b.txt'))).toBe(false);

    // a file changed on disk blocks the update, and stays as it is
    writeFileSync(join(mine, 'a.txt'), 'edited\n');
    await panel.getByTestId('remote-primary').click(); // Update ↓2
    await expect(active(page).getByTestId('update-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(existsSync(join(mine, 'b.txt'))).toBe(false);
    git(mine, 'checkout', '--', 'a.txt');

    // clean: fast-forward
    await expect(panel.getByTestId('remote-primary')).toContainText('Update', { timeout: 20_000 });
    await panel.getByTestId('remote-primary').click();
    await active(page).getByTestId('update-confirm').click();
    await expect(status).toHaveAttribute('data-status', 'up-to-date', { timeout: 30_000 });
    expect(existsSync(join(mine, 'c.txt'))).toBe(true);

    // a switch made by another program shows up without a refresh
    git(mine, 'switch', '-c', 'from-outside');
    await expect(page.getByTestId('location-branch')).toContainText('from-outside', { timeout: 30_000 });
  } finally {
    await f.app.close().catch(() => undefined);
  }
});
