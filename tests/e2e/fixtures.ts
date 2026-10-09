import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const consoleLog = new WeakMap<Page, string[]>();

export interface AppFixture {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

export async function launch(extraEnv: Record<string, string> = {}, userData?: string): Promise<AppFixture> {
  const dir = userData ?? mkdtempSync(join(tmpdir(), 'arctri-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, ARCTRI_USER_DATA: dir, ARCTRI_E2E: '1', ...extraEnv } as Record<string, string>
  });
  const page = await app.firstWindow();
  const lines: string[] = [];
  consoleLog.set(page, lines);
  page.on('console', (m) => lines.push(`[${m.type()}] ${m.text()}`.slice(0, 2000)));
  page.on('pageerror', (e) => lines.push(`[pageerror] ${String(e)}`));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userData: dir };
}

/** Evidence for a failed test: what the window looked like and what the main process thought of each session. */
async function attachEvidence(f: AppFixture, outDir: (name: string) => string): Promise<void> {
  try {
    writeFileSync(outDir('console.log'), (consoleLog.get(f.page) ?? []).join('\n'));
    await f.page.screenshot({ path: outDir('failure.png') });
    const state = await f.page.evaluate(() => {
      const t = (window as unknown as { __arctriTest?: { sessions(): unknown[]; activeId(): string } }).__arctriTest;
      return { active: t?.activeId(), sessions: t?.sessions() };
    });
    writeFileSync(outDir('state.json'), JSON.stringify(state, null, 2));
  } catch {
    /* the app may already be gone */
  }
}

export const test = base.extend<{ ad: AppFixture }>({
  ad: async ({}, use, testInfo) => {
    const f = await launch();
    await use(f);
    if (testInfo.status !== testInfo.expectedStatus) await attachEvidence(f, (n) => testInfo.outputPath(n));
    await f.app.close().catch(() => undefined);
  }
});

export { expect };

/** The session that is on screen. Hidden tabs stay mounted, so every query is scoped to this. */
export const active = (page: Page) => page.locator('[data-active="true"]');
export const activeBlocks = (page: Page) => active(page).locator('[data-block-id]');
export const activeEditor = (page: Page) => active(page).getByTestId('command-editor');

/** Waits until the block editor of the active tab is ready (shell integration active and a prompt shown). */
export async function waitForEditor(page: Page, timeout = 40_000): Promise<void> {
  await expect(activeEditor(page)).toBeVisible({ timeout });
  // The main process has to know the prompt state and folder too (autocomplete and submit depend on them).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const t = (window as unknown as { __arctriTest?: { activeId(): string; sessions(): Array<{ id: string; phase: string; cwd?: unknown }> } }).__arctriTest;
          const s = t?.sessions().find((x) => x.id === t.activeId());
          return !!s && (s.phase === 'editing' || s.phase === 'prompt') && !!s.cwd;
        }),
      { timeout }
    )
    .toBe(true);
}

/** After opening a tab: exactly `count` tabs exist and the newest one is the selected one. */
export async function expectNewTabSelected(page: Page, count: number): Promise<void> {
  await expect(page.getByRole('tab')).toHaveCount(count);
  await expect(page.getByRole('tab').nth(count - 1)).toHaveAttribute('aria-selected', 'true');
}

export async function runCommand(page: Page, command: string): Promise<void> {
  const editor = activeEditor(page);
  await editor.fill(command);
  await editor.press('Enter');
}

/**
 * Waits until the active tab shows exactly `n` blocks, all of them finished, and the editor is
 * ready again. A block appears when its command starts, so the count alone is not enough.
 */
export async function settled(page: Page, n: number, timeout = 30_000): Promise<void> {
  await expect(activeBlocks(page)).toHaveCount(n, { timeout });
  await expect(active(page).locator('[data-block-id] .animate-spin')).toHaveCount(0, { timeout });
  await waitForEditor(page, timeout);
}

/**
 * A real .exe launcher for the fake agent. A .cmd shim would make cmd.exe ask "Terminate batch job?"
 * on Ctrl+C, which real agents (native executables) never do.
 */
function ensureFakeAgentExe(): string {
  const dir = join(process.cwd(), 'tests', 'fixtures');
  const exe = join(dir, 'fake-codex.exe');
  if (!existsSync(exe)) {
    const src = join(dir, 'fake-launcher.cs');
    const csc = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, src], { stdio: 'pipe' });
  }
  return exe;
}

/** Starts the app with `codex` on Windows pointing at the fake full-screen agent. */
export async function launchWithFakeAgent(kind: 'exe' | 'cmd' = 'exe'): Promise<AppFixture> {
  const dir = mkdtempSync(join(tmpdir(), 'arctri-e2e-'));
  mkdirSync(dir, { recursive: true });
  const fake = kind === 'exe' ? ensureFakeAgentExe() : join(process.cwd(), 'tests', 'fixtures', 'fake-codex.cmd');
  writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ prefs: { agentPaths: { 'codex:windows': fake } } }));
  return launch({}, dir);
}
