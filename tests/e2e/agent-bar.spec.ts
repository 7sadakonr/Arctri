import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { active, activeBlocks, activeEditor, launch, settled, waitForEditor } from './fixtures';
import { screen, waitScreen } from './helpers';

const fixtures = join(process.cwd(), 'tests', 'fixtures');

function ensureFakeExe(): string {
  const exe = join(fixtures, 'fake-codex.exe');
  if (!existsSync(exe)) {
    const csc = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, join(fixtures, 'fake-launcher.cs')], { stdio: 'pipe' });
  }
  return exe;
}

/** A folder on PATH that has `codex.exe` and `claude.exe` (the full-screen fake agent), and a git repository with changes. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'ad bar '));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const exe = ensureFakeExe();
  for (const name of ['codex.exe', 'claude.exe']) copyFileSync(exe, join(bin, name));
  copyFileSync(join(fixtures, 'fake-agent.mjs'), join(bin, 'fake-agent.mjs'));
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  writeFileSync(join(repo, 'src', 'main.ts'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\n');
  writeFileSync(join(repo, 'ใหม่ file.txt'), 'new\n');
  const codexHome = join(root, 'codex-home');
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, 'config.toml'), '# mine\n[tui]\ntheme = "x"\n');
  return { root, bin, repo, codexHome };
}

async function startApp(w: ReturnType<typeof workspace>, extra: Record<string, string> = {}) {
  return launch({
    PATH: `${w.bin};${process.env['PATH']}`,
    CODEX_HOME: w.codexHome,
    ARCTRI_E2E_PICK: JSON.stringify([join(w.repo, 'a.txt')]),
    ...extra
  });
}

async function runAgent(page: import('@playwright/test').Page, w: ReturnType<typeof workspace>, command: string) {
  await waitForEditor(page);
  const editor = activeEditor(page);
  await editor.fill(`Set-Location -LiteralPath '${w.repo}'`);
  await editor.press('Enter');
  await settled(page, 1);
  await editor.fill(command);
  await editor.press('Enter');
  await waitScreen(page, 'FAKE-AGENT ready', 30_000);
}

test('typing codex in a shell tab switches to the Codex bar, with working controls', async () => {
  const w = workspace();
  const { app, page } = await startApp(w);
  try {
    await runAgent(page, w, 'codex');
    const bar = active(page).getByTestId('agent-bar');
    await expect(bar).toHaveAttribute('data-agent', 'codex');
    // the shell's editor is gone while the agent is in charge, and the bar offers no /remote-control for Codex
    await expect(active(page).getByTestId('command-editor')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '/remote-control' })).toHaveCount(0);

    // the status bar never covers the program's first row
    const barBox = (await active(page).getByTestId('running-bar').boundingBox())!;
    const screenBox = (await active(page).locator('.xterm-screen').boundingBox())!;
    expect(screenBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);

    await page.screenshot({ path: 'test-results/agent-bar-codex.png' });
    // changed files: a.txt (+3) and one untracked file
    await expect(bar.getByRole('button', { name: /2 changed files/ })).toContainText('+3', { timeout: 15_000 });

    // "+" attaches the chosen file as @path without sending anything
    await bar.getByRole('button', { name: /attach files/i }).click();
    await waitScreen(page, /paste: @a\.txt/);
    expect(await screen(page)).not.toMatch(/submitted:/);

    // the file panel lists the folder (read-only), a click opens the file beside the terminal, Alt+click inserts the path
    // (the sidebar is open from the start)
    const panel = active(page).getByTestId('file-panel');
    await expect(panel.getByRole('treeitem', { name: /main\.ts|src/ }).first()).toBeVisible();
    await panel.getByRole('treeitem', { name: /^src/ }).click();
    await panel.getByRole('treeitem', { name: /main\.ts/ }).click({ modifiers: ['Alt'] });
    await waitScreen(page, /paste: @src\/main\.ts/);
    await panel.getByRole('treeitem', { name: /main\.ts/ }).click();
    await expect(active(page).getByTestId('file-viewer')).toBeVisible();
    // a second file opens as a second tab; closing tabs one by one ends with the panel closing
    await panel.getByRole('treeitem', { name: /a\.txt/ }).first().click();
    const viewer = active(page).getByTestId('file-viewer');
    await expect(viewer.getByRole('tab')).toHaveCount(2);
    await viewer.getByRole('button', { name: /close tab/i }).first().click();
    await expect(viewer.getByRole('tab')).toHaveCount(1);
    await viewer.getByRole('button', { name: /close tab/i }).click();
    await expect(active(page).getByTestId('file-viewer')).toHaveCount(0);
    await panel.getByLabel(/filter/i).fill('a.t');
    await expect(panel.getByRole('treeitem', { name: /a\.txt/ })).toBeVisible();
    await expect(panel.getByRole('treeitem', { name: /main\.ts/ })).toHaveCount(0);
    await page.keyboard.press('Control+Shift+E');
    await expect(panel).toHaveCount(0);

    // Rich Input: Ctrl+G opens it, Enter sends (paste + Enter), Thai text survives
    await page.keyboard.press('Control+g');
    const rich = active(page).getByTestId('rich-input');
    await expect(rich).toBeVisible();
    await rich.getByRole('textbox').fill('ทดสอบ rich input');
    await rich.getByRole('textbox').press('Enter');
    // the fake agent shows pasted text on its own line and reports Enter as "submitted"
    await waitScreen(page, /paste: ทดสอบ rich input[\s\S]*note: submitted:/);
    await expect(rich).toHaveCount(0);

    // the Codex notifications chip changes the config after a backup, then goes away
    await bar.getByRole('button', { name: /enable codex notifications/i }).click();
    await expect(bar.getByRole('button', { name: /enable codex notifications/i })).toHaveCount(0);
    const cfg = readFileSync(join(w.codexHome, 'config.toml'), 'utf8');
    expect(cfg).toContain('# mine');
    expect(cfg).toContain('notifications = true');
    expect(cfg).toContain('theme = "x"');
    expect(readdirSync(w.codexHome).some((f) => f.startsWith('config.toml.arctri-backup-'))).toBe(true);

    // the agent ends: the shell comes back, with its editor and its own bar
    await page.keyboard.press('Control+c');
    await expect(active(page).getByTestId('agent-bar')).toHaveCount(0, { timeout: 20_000 });
    await settled(page, 2, 20_000);
    await expect(activeBlocks(page).nth(1)).toContainText('codex');
  } finally {
    await app.close();
  }
});

test('typing claude gives the Claude bar, which has /remote-control and no Codex chip', async () => {
  const w = workspace();
  const { app, page } = await startApp(w);
  try {
    await runAgent(page, w, 'claude --resume');
    const bar = active(page).getByTestId('agent-bar');
    await expect(bar).toHaveAttribute('data-agent', 'claude-code');
    await expect(bar.getByRole('button', { name: '/remote-control' })).toBeVisible();
    await expect(bar.getByRole('button', { name: /enable codex notifications/i })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/agent-bar-claude.png' });
    await bar.getByRole('button', { name: '/remote-control' }).click();
    await waitScreen(page, /submitted:\/remote-control/);
  } finally {
    await app.close();
  }
});

test('one-shot uses of an agent CLI do not switch the bar', async () => {
  const w = workspace();
  const { app, page } = await startApp(w);
  try {
    await waitForEditor(page);
    const editor = activeEditor(page);
    await editor.fill('codex --version');
    await editor.press('Enter');
    await settled(page, 1);
    await expect(active(page).getByTestId('agent-bar')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('an agent in a background tab marks the tab and raises a notification', async () => {
  const w = workspace();
  const { app, page } = await startApp(w);
  try {
    await runAgent(page, w, 'codex --notify-after 3');
    await page.keyboard.press('Control+Shift+T');
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab').first().locator('[data-dot]')).toHaveAttribute('data-dot', /bg-accent/, { timeout: 15_000 });
    const diag = await page.evaluate(() => (window as unknown as { arctri: { app: { diagnostics(): Promise<{ notifications?: unknown[] }> } } }).arctri.app.diagnostics());
    expect(diag.notifications?.length).toBeGreaterThanOrEqual(1);
    // opening the tab clears the mark
    await page.getByRole('tab').first().click();
    await expect(page.getByRole('tab').first().locator('[data-dot]')).not.toHaveAttribute('data-dot', /bg-accent/);
  } finally {
    await app.close();
  }
});

test('tab status dots: always present, never red while a new tab starts', async () => {
  const f = await launch();
  const { page, app } = f;
  try {
    await waitForEditor(page);
    await page.evaluate(() => {
      const w = window as unknown as { __dots: Set<string>; __missing: number };
      w.__dots = new Set();
      w.__missing = 0;
      setInterval(() => {
        for (const t of document.querySelectorAll('[role=tab]')) {
          const d = t.querySelector('[data-dot]');
          if (!d) w.__missing++;
          else w.__dots.add(d.getAttribute('data-dot')!.replace(/transition-colors|duration-150|h-1\.5|w-1\.5|shrink-0|rounded-full/g, '').trim());
        }
      }, 15);
    });
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+Shift+T');
      await expect(page.getByRole('tab')).toHaveCount(i + 2);
      await page.waitForTimeout(6000);
    }
    const r = await page.evaluate(() => ({ dots: [...(window as unknown as { __dots: Set<string> }).__dots], missing: (window as unknown as { __missing: number }).__missing }));
    expect(r.missing).toBe(0);
    expect(r.dots.join('|')).not.toMatch(/danger/);
    expect(r.dots.join('|')).not.toMatch(/animate-pulse/);
  } finally {
    await app.close();
  }
});
