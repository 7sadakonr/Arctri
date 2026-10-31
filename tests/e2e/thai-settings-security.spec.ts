import { expect, launch, test, activeBlocks, activeEditor, settled, waitForEditor } from './fixtures';

test('Thai text in the editor: composition does not trigger actions, commit and history work', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  const editor = activeEditor(page);
  await editor.focus();
  const cdp = await page.context().newCDPSession(page);

  // an input method composes ก → กา → กาแฟ; Enter during composition must not run anything
  await cdp.send('Input.imeSetComposition', { text: 'ก', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: 'กา', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.imeSetComposition', { text: 'กาแฟ', selectionStart: 4, selectionEnd: 4 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await expect(activeBlocks(page)).toHaveCount(0);
  await cdp.send('Input.insertText', { text: 'กาแฟ' });
  await expect(editor).toHaveValue('กาแฟ');

  // combining marks: vowels above/below and tone marks stay in one piece through edit and run
  await editor.fill('Write-Output "ผู้ใหญ่ ที่นี่ ฤๅษี กำลัง"');
  await editor.press('Enter');
  await settled(page, 1);
  await expect(activeBlocks(page).first().locator('.block-output').last()).toHaveText('ผู้ใหญ่ ที่นี่ ฤๅษี กำลัง');

  // Thai command history: Up arrow brings the Thai command back intact
  await editor.press('ArrowUp');
  await expect(editor).toHaveValue('Write-Output "ผู้ใหญ่ ที่นี่ ฤๅษี กำลัง"');
});

test('settings: Thai UI, light theme and persistence across restarts', async () => {
  const f = await launch();
  const { page } = f;
  try {
    await waitForEditor(page);
    await page.keyboard.press('Control+,');
    await page.getByRole('dialog').locator('select').first().selectOption('th');
    await expect(page.getByRole('dialog')).toContainText('ตั้งค่า');
    await page.getByRole('dialog').locator('select').nth(1).selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('dialog').getByRole('button', { name: 'ปิด' }).click();
    await expect(page.getByRole('button', { name: 'แท็บใหม่' }).first()).toBeVisible();
    await expect(activeEditor(page)).toHaveAttribute('aria-label', 'คำสั่ง');
  } finally {
    await f.app.close();
  }
  const again = await launch({}, f.userData);
  try {
    await waitForEditor(again.page);
    await expect(again.page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(activeEditor(again.page)).toHaveAttribute('aria-label', 'คำสั่ง');
    // tab layout is restored (as a new shell; processes do not survive a restart)
    await expect(again.page.locator('[role="tab"][data-tab-kind="session"]')).toHaveCount(1);
  } finally {
    await again.app.close();
  }
});

test('electron security: isolation, no node in the page, validated IPC, no navigation away', async ({ ad }) => {
  const { page, app } = ad;
  await waitForEditor(page);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const wp = BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences();
    return { ctx: wp.contextIsolation, node: wp.nodeIntegration, sandbox: wp.sandbox, web: wp.webSecurity };
  });
  expect(prefs).toEqual({ ctx: true, node: false, sandbox: true, web: true });

  const probe = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const api = w['arctri'] as Record<string, unknown>;
    return {
      require: typeof w['require'], process: typeof w['process'], buffer: typeof w['Buffer'],
      keys: Object.keys(api).sort(), hasExec: JSON.stringify(Object.keys(api)).match(/exec|spawn|shell/i)
    };
  });
  expect(probe.require).toBe('undefined');
  expect(probe.process).toBe('undefined');
  expect(probe.buffer).toBe('undefined');
  expect(probe.hasExec).toBeNull();

  // arguments are validated in the main process
  const results = await page.evaluate(async () => {
    const api = (window as unknown as { arctri: { sessions: Record<string, (...a: unknown[]) => Promise<unknown>> } }).arctri;
    const attempt = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => String(e.message));
    return {
      badResize: await attempt(api.sessions['resize']!('x', -5, 10)),
      unknownProfile: await attempt(api.sessions['create']!({ profileId: 'no-such', kind: 'shell', cols: 80, rows: 24 })),
      badSubmit: await attempt(api.sessions['submit']!(123, 'x'))
    };
  });
  expect(results.badResize).toContain('E_INVALID_ARGS');
  expect(results.unknownProfile).toContain('Unknown profile');
  expect(results.badSubmit).toContain('E_INVALID_ARGS');

  // the page cannot be navigated to a remote site
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(1500);
  expect(page.url()).not.toContain('example.com');
});
