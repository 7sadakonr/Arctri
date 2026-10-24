import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launch, waitForEditor } from './fixtures';

const fixtures = join(process.cwd(), 'tests', 'fixtures');

function fakeBin(): string {
  const exe = join(fixtures, 'fake-codex.exe');
  if (!existsSync(exe)) {
    const csc = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, join(fixtures, 'fake-launcher.cs')], { stdio: 'pipe' });
  }
  const bin = join(mkdtempSync(join(tmpdir(), 'ad status ')), 'bin');
  mkdirSync(bin);
  for (const name of ['codex.exe', 'claude.exe']) copyFileSync(exe, join(bin, name));
  copyFileSync(join(fixtures, 'fake-agent.mjs'), join(bin, 'fake-agent.mjs'));
  return bin;
}

type Arctri = { sessions: { create(s: unknown): Promise<{ id: string; nonce: string }> } };

async function startAgentTab(page: Page, adapterId: 'claude-code' | 'codex', extraArgs: string[] = []) {
  return page.evaluate(
    ([id, extra]) => (window as unknown as { arctri: Arctri }).arctri.sessions.create({
      profileId: 'pwsh', kind: 'agent', agent: { adapterId: id, options: { extraArgs: extra } }, cols: 100, rows: 30
    }),
    [adapterId, extraArgs] as const
  );
}

/** What a hook script writes; the file only counts when it carries the tab's own secret. */
function drop(userData: string, id: string, name: string, nonce: string, agent: 'claude' | 'codex', payload: unknown, model?: string) {
  const dir = join(userData, 'agent-events', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json.tmp`), JSON.stringify({ nonce, agent, ...(model !== undefined ? { model } : {}), payload }));
  copyFileSync(join(dir, `${name}.json.tmp`), join(dir, `${name}.json`));
}

test('structured events drive the tab, the attention center and the palette; plain output never asks for approval', async () => {
  const bin = fakeBin();
  const { app, page, userData } = await launch({ PATH: `${bin};${process.env['PATH']}` });
  try {
    await waitForEditor(page);
    const a = await startAgentTab(page, 'claude-code');
    await expect(page.getByRole('tab')).toHaveCount(2);
    const agentTab = page.getByRole('tab').nth(1);
    await page.getByRole('tab').first().click(); // the agent tab goes to the background

    // The fake agent prints "Allow command? (y/n)": text on the screen is not a permission request
    await page.waitForTimeout(2500);
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'unknown');
    await expect(agentTab.locator('[data-dot]')).toHaveCount(0); // an agent tab has an icon, not a dot
    await expect(page.getByTestId('tab-approval')).toHaveCount(0);

    // a forged event (wrong secret) is dropped
    drop(userData, a.id, 'forged', 'wrong', 'claude', { hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('tab-approval')).toHaveCount(0);

    // the real one marks the tab
    drop(userData, a.id, 'real', a.nonce, 'claude', { hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: 's' });
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'approval', { timeout: 10_000 });
    await expect(page.getByTestId('tab-approval')).toHaveCount(1);
    await expect(page.getByTestId('attention-badge')).toHaveText('1');

    // the bell lists it and a click goes to that terminal; nothing there approves or denies
    await page.getByTestId('attention-button').click();
    const row = page.getByTestId('attention-row-approval');
    await expect(row).toHaveCount(1);
    await expect(page.getByRole('button', { name: /approve|deny/i })).toHaveCount(0);
    await row.click();
    await expect(agentTab).toHaveAttribute('aria-selected', 'true');
    // looking at the tab does not answer the approval: it stays on the bell until the agent moves on
    await page.waitForTimeout(800);
    await expect(page.getByTestId('attention-badge')).toHaveAttribute('data-unresolved', '1');
    // nor does typing: no false approved / ready / dismissed
    await page.keyboard.type('y');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'approval');
    await expect(page.getByTestId('attention-badge')).toHaveAttribute('data-unresolved', '1');
    drop(userData, a.id, 'resume', a.nonce, 'claude', { hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    await expect(page.getByTestId('attention-badge')).toHaveCount(0, { timeout: 10_000 });

    // a finished turn in the background
    await page.getByRole('tab').first().click();
    drop(userData, a.id, 'done', a.nonce, 'claude', { hook_event_name: 'Stop' });
    await expect(page.getByTestId('attention-badge')).toHaveText('1', { timeout: 10_000 });
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'finished');
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-unread', 'true');

    // the palette: Ctrl+Shift+P, find the session by agent name, Enter switches to it
    await page.keyboard.press('Control+Shift+P');
    await page.getByTestId('palette-input').fill('claude');
    await expect(page.getByTestId(`palette-session-${a.id}`)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(agentTab).toHaveAttribute('aria-selected', 'true');

    // Working turns; SessionEnd (it also comes with /clear) does not end anything; Esc while it works means "not known any more"
    drop(userData, a.id, 'work', a.nonce, 'claude', { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'working', { timeout: 10_000 });
    await expect(agentTab.locator('[data-status] svg')).toHaveClass(/ad-spin-12/);
    drop(userData, a.id, 'end', a.nonce, 'claude', { hook_event_name: 'SessionEnd', reason: 'clear' });
    await page.waitForTimeout(1500);
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'working');
    await page.keyboard.press('Escape');
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'unknown', { timeout: 5000 });
    drop(userData, a.id, 'again', a.nonce, 'claude', { hook_event_name: 'SessionStart', source: 'clear' });
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'ready', { timeout: 10_000 });

    // Claude asks the user a question while its tab is in the background: Waiting at once, and the permission notification that
    // follows several seconds later does not make it an approval
    await page.getByRole('tab').first().click();
    drop(userData, a.id, 'q1', a.nonce, 'claude', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' });
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'waiting', { timeout: 10_000 });
    drop(userData, a.id, 'q2', a.nonce, 'claude', { hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    await page.waitForTimeout(1500);
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'waiting');
    // looking at that tab never changes the truth: it is still a question, only the unread marker goes
    await agentTab.click();
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'waiting');
    await expect(agentTab.locator('[data-status]')).not.toHaveAttribute('data-unread', 'true');
    await page.getByTestId('attention-button').click();
    await expect(page.getByTestId('attention-row-waiting')).toHaveCount(1);
    await page.keyboard.press('Escape');
    drop(userData, a.id, 'q3', a.nonce, 'claude', { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' });
    await expect(agentTab.locator('[data-status]')).toHaveAttribute('data-status', 'working', { timeout: 10_000 });

    // a command runs from the palette as well
    await page.keyboard.press('Control+Shift+P');
    await page.getByTestId('palette-input').fill('zoom in');
    await expect(page.getByTestId('palette-cmd-view.zoomIn')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette-input')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('pinned tabs stay at the left, are as wide as the others, show a filled pin instead of close and cannot be closed with the middle button', async () => {
  const { app, page } = await launch();
  try {
    await waitForEditor(page);
    await page.keyboard.press('Control+Shift+T');
    await page.keyboard.press('Control+Shift+T');
    await expect(page.getByRole('tab')).toHaveCount(3);
    const third = page.getByRole('tab').nth(2);
    await third.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^pin tab/i }).click();
    const pinnedTab = page.getByRole('tab').first();
    await expect(pinnedTab.getByRole('button', { name: /close tab/i })).toHaveCount(0);
    await expect(pinnedTab.getByRole('button', { name: /unpin tab/i })).toBeVisible();
    const [pw, ow] = [(await pinnedTab.boundingBox())!.width, (await page.getByRole('tab').nth(1).boundingBox())!.width];
    expect(Math.abs(pw - ow)).toBeLessThan(2);
    await pinnedTab.click({ button: 'middle' });
    await expect(page.getByRole('tab')).toHaveCount(3);

    // the pin in the tab unpins it and brings the close button back
    await pinnedTab.getByRole('button', { name: /unpin tab/i }).click();
    await expect(page.getByRole('tab').first().getByRole('button', { name: /close tab/i })).toHaveCount(1);

    // and so does the context menu
    await page.getByRole('tab').nth(2).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^pin tab/i }).click();
    await page.getByRole('tab').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /unpin tab/i }).click();
    await expect(page.getByRole('tab').first().getByRole('button', { name: /close tab/i })).toHaveCount(1);
  } finally {
    await app.close();
  }
});

const mark = (page: Page, n: number) => page.getByRole('tab').nth(n).locator('[data-status]');

test('a shell tab goes starting, ready, running, ready; its tooltip says so in English and Thai', async () => {
  const { app, page } = await launch();
  try {
    await expect(mark(page, 0)).toHaveAttribute('data-status', /starting|ready/);
    await waitForEditor(page);
    await expect(mark(page, 0)).toHaveAttribute('data-status', 'ready');
    const editor = page.locator('[data-active="true"] [data-testid="command-editor"]');
    await editor.fill('Start-Sleep -Seconds 4');
    await editor.press('Enter');
    await expect(mark(page, 0)).toHaveAttribute('data-status', 'running', { timeout: 5000 });
    await expect(mark(page, 0).locator('svg')).toHaveClass(/ad-spin-14/);
    await expect(mark(page, 0)).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });

    // tooltip on hover, and on keyboard focus
    await page.getByRole('tab').first().hover();
    await expect(page.getByTestId('tab-tooltip')).toContainText('Status: Ready');
    await page.mouse.move(600, 400);
    await page.evaluate(() => (window as unknown as { arctri: { prefs: { set(p: unknown): Promise<unknown> } } }).arctri.prefs.set({ language: 'th' }));
    await page.reload();
    await expect(mark(page, 0)).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
    await page.getByRole('tab').first().focus();
    await expect(page.getByTestId('tab-tooltip')).toContainText('สถานะ: พร้อม');
  } finally {
    await app.close();
  }
});

test('working spins without restarting, stops with reduced motion; two agents are independent; closing a tab mid-events is quiet; a reload keeps the truth', async () => {
  const bin = fakeBin();
  const { app, page, userData } = await launch({ PATH: `${bin};${process.env['PATH']}` });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await waitForEditor(page);
    const c = await startAgentTab(page, 'claude-code');
    const x = await startAgentTab(page, 'codex');
    await expect(page.getByRole('tab')).toHaveCount(3);
    await page.getByRole('tab').first().click();

    // independent: Claude asks for approval while Codex finishes a turn
    drop(userData, c.id, 'c1', c.nonce, 'claude', { hook_event_name: 'UserPromptSubmit' });
    drop(userData, x.id, 'x1', x.nonce, 'codex', { type: 'agent-turn-complete' });
    await expect(mark(page, 1)).toHaveAttribute('data-status', 'working', { timeout: 10_000 });
    await expect(mark(page, 2)).toHaveAttribute('data-status', 'finished', { timeout: 10_000 });

    // the spinner keeps its place in the rotation through unrelated re-renders (a rename elsewhere, a pin)
    const time = () => mark(page, 1).locator('svg').evaluate((el) => Number(el.getAnimations()[0]?.currentTime ?? -1));
    const t1 = await time();
    expect(t1).toBeGreaterThanOrEqual(0);
    await page.evaluate((id) => (window as unknown as { arctri: { sessions: { rename(i: string, t: string): Promise<void> } } }).arctri.sessions.rename(id, 'renamed'), x.id);
    await page.getByRole('tab').nth(2).hover();
    const t2 = await time();
    expect(t2).toBeGreaterThan(t1);

    // reduced motion: nothing is animated
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await mark(page, 1).locator('svg').evaluate((el) => el.getAnimations().length)).toBe(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // approval stays unresolved when its tab is opened (viewing is not approving)
    drop(userData, c.id, 'c2', c.nonce, 'claude', { hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    await expect(mark(page, 1)).toHaveAttribute('data-status', 'approval', { timeout: 10_000 });
    await page.getByRole('tab').nth(1).click();
    await page.waitForTimeout(800);
    await expect(mark(page, 1)).toHaveAttribute('data-status', 'approval');
    await expect(page.getByTestId('attention-badge')).toHaveAttribute('data-unresolved', '1');

    // a reload shows what is true now, and does not announce it again
    const before = await page.evaluate(async () => ((await (window as unknown as { arctri: { app: { diagnostics(): Promise<{ notifications?: unknown[] }> } } }).arctri.app.diagnostics()).notifications ?? []).length);
    await page.reload();
    await expect(mark(page, 1)).toHaveAttribute('data-status', 'approval', { timeout: 15_000 });
    const after = await page.evaluate(async () => ((await (window as unknown as { arctri: { app: { diagnostics(): Promise<{ notifications?: unknown[] }> } } }).arctri.app.diagnostics()).notifications ?? []).length);
    expect(after).toBe(before);

    // close the Codex tab and keep sending events to it
    await page.evaluate((id) => (window as unknown as { arctri: { sessions: { close(i: string): Promise<void> } } }).arctri.sessions.close(id), x.id);
    drop(userData, x.id, 'x2', x.nonce, 'codex', { type: 'agent-turn-complete' });
    await expect(page.getByRole('tab')).toHaveCount(2);
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('a tab shows what the agent says it is working on, with the logo first and the status after the name', async () => {
  const bin = fakeBin();
  const { app, page } = await launch({ PATH: `${bin};${process.env['PATH']}` });
  try {
    await waitForEditor(page);
    await startAgentTab(page, 'claude-code', ['--title', 'Fix_tab_status']);
    await expect(page.getByRole('tab')).toHaveCount(2);
    const tab = page.getByRole('tab').nth(1);
    await expect(tab).toContainText('Fix_tab_status', { timeout: 15_000 });
    await expect(tab).not.toContainText('Claude Code ·');

    // order in the tab: logo, name, status
    const order = await tab.evaluate((el) => {
      const pos = (sel: string) => {
        const n = el.querySelector(sel);
        return n ? [...el.querySelectorAll('*')].indexOf(n) : -1;
      };
      const name = [...el.querySelectorAll('span')].find((s) => s.textContent === 'Fix_tab_status');
      return { logo: pos('[data-agent-logo]'), name: name ? [...el.querySelectorAll('*')].indexOf(name) : -1, status: pos('[data-status]') };
    });
    expect(order.logo).toBeGreaterThanOrEqual(0);
    expect(order.logo).toBeLessThan(order.name);
    expect(order.name).toBeLessThan(order.status);

    // the tooltip names the session; a name the user chose wins over the agent's
    await tab.hover();
    await expect(page.getByTestId('tab-tooltip')).toContainText('Fix_tab_status');
    await page.mouse.move(600, 400);
    await page.evaluate(() => {
      const w = window as unknown as { __arctriTest: { sessions(): Array<{ id: string; kind: string }> }; arctri: { sessions: { rename(i: string, t: string): Promise<void> } } };
      const id = w.__arctriTest.sessions().find((s) => s.kind === 'agent')!.id;
      return w.arctri.sessions.rename(id, 'My own name');
    });
    await expect(tab).toContainText('My own name');
    await expect(tab).not.toContainText('Fix_tab_status');
  } finally {
    await app.close();
  }
});

test('the agent bar shows the model in use for Claude and Codex, keeps it, follows a change and hides it when unknown', async () => {
  const bin = fakeBin();
  const { app, page, userData } = await launch({ PATH: `${bin};${process.env['PATH']}` });
  try {
    await waitForEditor(page);
    const claude = await startAgentTab(page, 'claude-code');
    await expect(page.getByRole('tab')).toHaveCount(2);
    await page.getByRole('tab').nth(1).click();
    const bar = page.locator('[data-testid="agent-bar"]:visible'); // bars of background tabs stay mounted but hidden
    const model = bar.getByTestId('agent-model');
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(model).toHaveCount(0); // nothing reported yet: nothing guessed

    drop(userData, claude.id, 'm1', claude.nonce, 'claude', { hook_event_name: 'SessionStart' }, 'claude-opus-5-5');
    await expect(model).toHaveText('claude-opus-5-5', { timeout: 10_000 });
    drop(userData, claude.id, 'm2', claude.nonce, 'claude', { hook_event_name: 'UserPromptSubmit' }); // later events do not repeat it
    await page.waitForTimeout(1200);
    await expect(model).toHaveText('claude-opus-5-5');
    drop(userData, claude.id, 'm3', claude.nonce, 'claude', { hook_event_name: 'Stop' }, 'claude-sonnet-5-5'); // /model was used
    await expect(model).toHaveText('claude-sonnet-5-5', { timeout: 10_000 });
    drop(userData, claude.id, 'm4', claude.nonce, 'claude', { hook_event_name: 'UserPromptSubmit' }, 'bad name;');
    await page.waitForTimeout(1200);
    await expect(model).toHaveText('claude-sonnet-5-5'); // an implausible name is ignored

    const codex = await startAgentTab(page, 'codex');
    await expect(page.getByRole('tab')).toHaveCount(3);
    await page.getByRole('tab').nth(2).click();
    await expect(bar).toHaveAttribute('data-agent', 'codex', { timeout: 15_000 });
    await expect(model).toHaveCount(0); // each tab has its own model
    drop(userData, codex.id, 'c1', codex.nonce, 'codex', { type: 'agent-turn-complete', 'thread-id': 't-1' }, 'gpt-6-sol');
    await expect(model).toHaveText('gpt-6-sol', { timeout: 10_000 });
    await expect(model).toHaveAttribute('class', /truncate/);
  } finally {
    await app.close();
  }
});
