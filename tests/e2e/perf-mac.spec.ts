import { test } from '@playwright/test';
import { launch, waitForEditor } from './fixtures';

// Measurements for the macOS performance work. Nothing is asserted: the numbers are printed as PERF lines, the same way
// tests/integration/perf.test.ts does it, so a change can be compared with the run before it.
test.skip(process.platform !== 'darwin', 'macOS measurements');

const WINDOW_MS = Number(process.env['ARCTRI_PERF_MS'] ?? 15_000);

test('idle cost: animations, frames and CPU of a window that is doing nothing', async () => {
  test.setTimeout(180_000);
  const f = await launch();
  const { page, app } = f;
  try {
    await waitForEditor(page, 60_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number };
      w.__frames = 0;
      const tick = () => {
        w.__frames++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const cpu = () => app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })));

    const anims = await page.evaluate(() =>
      document.getAnimations().map((a) => {
        const t = (a as CSSAnimation).effect?.target as Element | null;
        return { name: (a as CSSAnimation).animationName ?? a.constructor.name, state: a.playState, el: t ? `${t.tagName.toLowerCase()}.${String(t.getAttribute('class')).slice(0, 60)}` : '' };
      })
    );
    console.log(`PERF idle animations=${JSON.stringify(anims)}`);

    const m0 = await metrics();
    await cpu();
    await page.waitForTimeout(WINDOW_MS);
    const m1 = await metrics();
    const procs = await cpu();
    const frames = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
    const sec = WINDOW_MS / 1000;
    const d = (k: string) => ((m1[k] ?? 0) - (m0[k] ?? 0)) / sec;
    console.log(
      `PERF idle seconds=${sec} fps=${(frames / sec).toFixed(1)} taskMsPerSec=${(d('TaskDuration') * 1000).toFixed(1)} scriptMsPerSec=${(d('ScriptDuration') * 1000).toFixed(1)} ` +
        `layoutPerSec=${d('LayoutCount').toFixed(1)} recalcPerSec=${d('RecalcStyleCount').toFixed(1)} cpu=${JSON.stringify(procs)}`
    );
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('tab cost: opening a tab, and switching between two', async () => {
  test.setTimeout(180_000);
  const f = await launch();
  const { page, app } = f;
  try {
    await waitForEditor(page, 60_000);
    const tabs = page.locator('[role="tab"][data-tab-kind="session"]');
    const t0 = Date.now();
    await page.keyboard.press('Meta+t');
    await tabs.nth(1).waitFor();
    await waitForEditor(page, 60_000);
    console.log(`PERF new-tab-to-prompt ms=${Date.now() - t0}`);

    const frame = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = performance.now();
      await tabs.nth(i % 2).click();
      await frame();
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    console.log(`PERF tab-switch median=${samples[6]!.toFixed(0)}ms p95=${samples[11]!.toFixed(0)}ms`);
  } finally {
    await app.close().catch(() => undefined);
  }
});
