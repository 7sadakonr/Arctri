import { expect, test as base } from '@playwright/test';
import { activeEditor, launch, waitForEditor, type AppFixture } from './fixtures';

// ARCTRI_UPDATE_FAKE replaces electron-updater with a scripted one: no network, and quitAndInstall only counts the call.
const open = (mode: 'none' | 'available' | 'error') => launch({ ARCTRI_UPDATE_FAKE: mode });

const checkViaHelpMenu = async (f: AppFixture) => {
  await f.page.getByRole('menubar').getByRole('button', { name: 'Help' }).click();
  await f.page.getByRole('menuitem', { name: /Check for Updates/ }).click();
};

base('Help > Check for Updates: up to date', async () => {
  const f = await open('none');
  try {
    await checkViaHelpMenu(f);
    await expect(f.page.getByTestId('update-summary')).toHaveText(/up to date/i);
    await expect(f.page.getByTestId('update-button')).toHaveCount(0);
  } finally {
    await f.app.close();
  }
});

base('an available update is downloaded and installed only when the user asks', async () => {
  const f = await open('available');
  try {
    await checkViaHelpMenu(f);
    await expect(f.page.getByTestId('update-summary')).toHaveText(/Version 99\.0\.0 is available/);
    // nothing is downloaded or installed by itself
    await expect(f.page.getByTestId('update-restart')).toHaveCount(0);

    await f.page.getByTestId('update-download').click();
    await expect(f.page.getByTestId('update-summary')).toHaveText(/ready to install/, { timeout: 15_000 });

    // "Later" keeps the update on offer in the title bar
    await f.page.getByRole('button', { name: 'Later' }).click();
    await expect(f.page.getByTestId('update-button')).toBeVisible();
    await f.page.getByTestId('update-button').click();
    await expect(f.page.getByTestId('update-restart')).toBeVisible();
  } finally {
    await f.app.close();
  }
});

base('an install is refused while a command runs, until the user confirms', async () => {
  const f = await open('available');
  try {
    await waitForEditor(f.page);
    await activeEditor(f.page).fill('Start-Sleep 60');
    await activeEditor(f.page).press('Enter');
    await expect(f.page.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 15_000 });

    await checkViaHelpMenu(f);
    await f.page.getByTestId('update-download').click();
    await expect(f.page.getByTestId('update-restart')).toBeVisible({ timeout: 15_000 });
    await f.page.getByTestId('update-restart').click();

    await expect(f.page.getByTestId('update-busy')).toContainText('still running');
    // the session was not touched
    await expect(f.page.getByRole('button', { name: /stop/i })).toBeVisible();
    await expect(f.page.getByTestId('update-restart-anyway')).toBeVisible();
  } finally {
    await f.app.close().catch(() => undefined);
  }
});

base('a failed check shows a message and the terminal stays usable', async () => {
  const f = await open('error');
  try {
    await waitForEditor(f.page);
    await checkViaHelpMenu(f);
    await expect(f.page.getByTestId('update-summary')).toHaveText(/Could not reach GitHub/);
    await expect(f.page.getByTestId('update-check')).toHaveText('Try again');
    await f.page.keyboard.press('Escape');
    await activeEditor(f.page).fill('echo still-works');
    await activeEditor(f.page).press('Enter');
    await expect(f.page.locator('[data-block-id]').first()).toContainText('still-works', { timeout: 20_000 });
  } finally {
    await f.app.close();
  }
});

base('Settings > Updates: version, automatic checks and channel are saved', async () => {
  const f = await open('none');
  try {
    await f.page.keyboard.press('Control+,');
    await expect(f.page.getByTestId('settings-version')).not.toHaveText('–');
    const auto = f.page.getByTestId('settings-update-auto');
    await expect(auto).toBeChecked();
    await auto.click();
    await expect(auto).not.toBeChecked();
    await f.page.getByRole('combobox').filter({ hasText: 'Beta' }).selectOption('stable');
    await expect
      .poll(() => f.page.evaluate(async () => (await (window as unknown as { arctri: { prefs: { get(): Promise<{ updates: unknown }> } } }).arctri.prefs.get()).updates))
      .toEqual({ autoCheck: false, channel: 'stable' });
  } finally {
    await f.app.close();
  }
});
