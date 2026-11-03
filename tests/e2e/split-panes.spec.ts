import { expect, test, waitForEditor } from './fixtures';

const sessionTabs = (page: import('@playwright/test').Page) => page.locator('[role="tab"][data-tab-kind="session"]');

/** Drags a tab onto an edge of a pane with real drag events (the tab strip and the drop overlay use HTML5 drag and drop). */
async function dragTabToEdge(page: import('@playwright/test').Page, tab: import('@playwright/test').Locator, pane: import('@playwright/test').Locator, edge: 'left' | 'right' | 'top' | 'bottom') {
  await tab.dragTo(pane, {
    targetPosition: {
      left: { x: 8, y: 200 },
      right: { x: (await pane.boundingBox())!.width - 8, y: 200 },
      top: { x: 300, y: 8 },
      bottom: { x: 300, y: (await pane.boundingBox())!.height - 8 }
    }[edge]
  });
}

test('dragging a tab to the right edge splits the window; both terminals stay visible and work', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(2);
  await waitForEditor(page, 40_000);
  await expect(page.locator('[data-group]')).toHaveCount(1);

  const pane = page.locator('[data-group]').first();
  await dragTabToEdge(page, sessionTabs(page).nth(1), pane, 'right');
  await expect(page.locator('[data-group]')).toHaveCount(2);

  // both terminals are on screen at once
  await expect(page.locator('[data-session][data-active="true"]')).toHaveCount(2);
  const boxes = await page.locator('[data-session][data-active="true"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(boxes.every((w) => w > 100)).toBe(true);
});

test('Split Right from the palette opens a second terminal beside the first, and closing it closes the pane', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+P');
  await page.getByRole('option', { name: /Split Right/ }).click();
  await expect(sessionTabs(page)).toHaveCount(2);
  await expect(page.locator('[data-session][data-active="true"]')).toHaveCount(2, { timeout: 40_000 });

  await sessionTabs(page).nth(1).getByRole('button', { name: /close tab/i }).click();
  await expect(sessionTabs(page)).toHaveCount(1);
  await expect(page.locator('[data-session][data-active="true"]')).toHaveCount(1);
});

test('a pane can be zoomed and restored without stopping the other terminal', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+P');
  await page.getByRole('option', { name: /Split Down/ }).click();
  await expect(page.locator('[data-session][data-active="true"]')).toHaveCount(2, { timeout: 40_000 });

  await page.getByTestId('pane-zoom').first().click();
  await expect(page.getByTestId('pane-divider')).toHaveCount(0);
  await page.getByTestId('pane-zoom').first().click();
  await expect(page.getByTestId('pane-divider')).not.toHaveCount(0);
});

test('a tab dropped on the bottom strip of the workspace spans the whole width, under both columns', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(2);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(3);
  await waitForEditor(page, 40_000);

  // tabs 1 | 2 side by side first
  const pane = page.locator('[data-group]').first();
  await dragTabToEdge(page, sessionTabs(page).nth(1), pane, 'right');
  await expect(page.locator('[data-group]')).toHaveCount(2);

  // the third goes to the bottom edge of the whole workspace: start dragging, then move to the bottom rim
  const workspace = page.getByTestId('workspace');
  const box = (await workspace.boundingBox())!;
  const third = (await sessionTabs(page).nth(1).boundingBox())!; // the third tab: it shares the first pane with tab 1
  await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width / 2 + 40, third.y + third.height / 2 + 60, { steps: 6 });
  await expect(page.getByTestId('drag-layer')).toBeVisible();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height - 10, { steps: 12 }); // (not at the middle: that is where the line between the two panes is)
  await expect(page.getByTestId('drop-highlight')).toHaveAttribute('data-target', /"kind":"root","edge":"bottom"/);
  // (the new pane's card opens out from the pointer, so give it a moment) it spans the whole window, not one pane
  const card = page.getByTestId('drop-highlight');
  await expect.poll(async () => (await card.boundingBox())!.width).toBeGreaterThan(box.width - 20);
  await expect.poll(async () => Math.round((await card.boundingBox())!.height)).toBeGreaterThan(box.height * 0.25);
  await page.waitForTimeout(300);
  const shownBox = (await card.boundingBox())!;
  // one highlight only, and no grips or strips on the window's edges
  await expect(page.getByTestId('drop-highlight')).toHaveCount(1);
  await expect(page.getByTestId('drag-layer').locator('> span')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('[data-group]')).toHaveCount(3);

  // the preview was the real size of the pane that appeared (2 px ring inset on each side)
  await expect
    .poll(async () => {
      const g = await page.locator('[data-group]').last().evaluate((e) => ({ w: (e as HTMLElement).offsetWidth, h: (e as HTMLElement).offsetHeight }));
      return Math.abs(g.h - shownBox.height - 4) + Math.abs(g.w - shownBox.width - 4);
    })
    .toBeLessThan(12);

  // (a new pane settles in with a short animation, so poll) one group is as wide as the workspace
  await expect
    .poll(async () => Math.max(...(await page.locator('[data-group]').evaluateAll((els) => els.map((e) => Math.round((e as HTMLElement).offsetWidth))))))
    .toBeGreaterThanOrEqual(Math.round(box.width) - 4);
});

test('dropping a tab into the tab strip of another pane puts it at that place', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(2);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(3);
  await waitForEditor(page, 40_000);

  const pane = page.locator('[data-group]').first();
  await dragTabToEdge(page, sessionTabs(page).nth(1), pane, 'right'); // [t1, t3] | [t2]
  await expect(page.locator('[data-group]')).toHaveCount(2);

  // tab 3 (second in the first pane) into the strip of the second pane, in front of its tab
  const from = (await sessionTabs(page).nth(1).boundingBox())!;
  const second = page.locator('[data-group]').nth(1);
  const strip = (await second.getByTestId('group-tabbar').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 30, { steps: 5 });
  await expect(page.getByTestId('drag-layer')).toBeVisible();
  await page.mouse.move(strip.x + 20, strip.y + strip.height / 2, { steps: 12 });
  await expect(page.getByTestId('drop-highlight')).toHaveAttribute('data-target', /"kind":"strip"/);
  await page.mouse.up();

  await expect(page.locator('[data-group]')).toHaveCount(2);
  // (a narrow pane may keep a tab in its overflow menu, so count in the layout rather than in the strip)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const l = (window as unknown as { __arctriTest: { layout(): { groups: Record<string, { tabs: string[] }> } } }).__arctriTest.layout();
        return Object.values(l.groups).map((g) => g.tabs.length).sort();
      })
    )
    .toEqual([1, 2]);
});

test('dropping on the line between two panes inserts a full-height pane there', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(3);
  await waitForEditor(page, 40_000);
  const pane = page.locator('[data-group]').first();
  await dragTabToEdge(page, sessionTabs(page).nth(1), pane, 'right'); // [t1, t3] | [t2]
  await expect(page.locator('[data-group]')).toHaveCount(2);

  const from = (await sessionTabs(page).nth(1).boundingBox())!;
  const line = (await page.getByTestId('pane-divider').first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 40, { steps: 5 });
  await expect(page.getByTestId('drag-layer')).toBeVisible();
  await page.mouse.move(line.x + 1, line.y + line.height / 2, { steps: 12 });
  await expect(page.getByTestId('drop-highlight')).toHaveAttribute('data-target', /"kind":"divider"/);
  await expect(page.getByTestId('drop-highlight')).toBeVisible(); // one highlight: the pane that would be inserted
  await page.mouse.up();

  await expect(page.locator('[data-group]')).toHaveCount(3);
  const ws = (await page.getByTestId('workspace').boundingBox())!;
  const rects = await page.locator('[data-group]').evaluateAll((els) => els.map((e) => ({ x: e.getBoundingClientRect().x, h: Math.round((e as HTMLElement).offsetHeight) })));
  rects.sort((a, b) => a.x - b.x);
  expect(rects).toHaveLength(3); // three columns, left to right
  for (const r of rects) expect(r.h).toBeGreaterThanOrEqual(Math.round(ws.height) - 4); // each is as tall as the window
});

test('dragging into the middle of a pane says it joins the tabs there', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(2);
  await waitForEditor(page, 40_000);
  const from = (await sessionTabs(page).nth(1).boundingBox())!;
  const ws = (await page.getByTestId('workspace').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 40, { steps: 5 });
  await page.mouse.move(ws.x + ws.width / 2, ws.y + ws.height / 2, { steps: 10 });
  const hl = page.getByTestId('drop-highlight');
  await expect(hl).toContainText(/Join as a tab/);
  await page.mouse.up();
});

test('three panes made one after the other are the same width', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Control+Shift+P');
    await page.getByRole('option', { name: /Split Right/ }).click();
    await expect(page.locator('[data-group]')).toHaveCount(i + 2, { timeout: 40_000 });
  }
  await expect
    .poll(async () => {
      const w = await page.locator('[data-group]').evaluateAll((els) => els.map((e) => Math.round((e as HTMLElement).offsetWidth)));
      return Math.max(...w) - Math.min(...w);
    })
    .toBeLessThanOrEqual(3);
});

test('with two panes the right of the first, the line and the left of the second are one zone', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(3);
  await waitForEditor(page, 40_000);
  const pane = page.locator('[data-group]').first();
  await dragTabToEdge(page, sessionTabs(page).nth(1), pane, 'right'); // [t1, t3] | [t2]
  await expect(page.locator('[data-group]')).toHaveCount(2);

  const from = (await sessionTabs(page).nth(1).boundingBox())!;
  const line = (await page.getByTestId('pane-divider').first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 40, { steps: 5 });
  await expect(page.getByTestId('drag-layer')).toBeVisible();
  const seen: string[] = [];
  const sizes: string[] = [];
  for (const dx of [-60, -2, 2, 60]) {
    await page.mouse.move(line.x + dx, line.y + 300, { steps: 6 });
    await expect(page.getByTestId('drop-highlight')).toBeVisible();
    await page.waitForTimeout(350);
    seen.push((await page.getByTestId('drop-highlight').getAttribute('data-target'))!);
    const b = (await page.getByTestId('drop-highlight').boundingBox())!;
    sizes.push(`${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  await page.mouse.up();
  expect(new Set(seen).size).toBe(1); // the same divider drop wherever on either side of the line
  expect(seen[0]).toContain('"kind":"divider"');
  expect(new Set(sizes).size).toBe(1); // and the same highlight
});

test('one compass in the pane the pointer is over, buttons on the window edges, nothing else drawn', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(3);
  await waitForEditor(page, 40_000);
  const pane = page.locator('[data-group]').first();
  await dragTabToEdge(page, sessionTabs(page).nth(1), pane, 'right'); // [t1, t3] | [t2]
  await expect(page.locator('[data-group]')).toHaveCount(2);

  const from = (await sessionTabs(page).nth(1).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 40, { steps: 5 });
  await expect(page.getByTestId('drag-layer')).toBeVisible();
  // none of the older guides, and the window's edge buttons are there (more than one pane)
  for (const id of ['drop-guide', 'drop-rim', 'drop-legend']) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByTestId('drop-edge-button')).toHaveCount(4);

  // over the middle of the first pane: its compass, with five buttons
  const first = (await page.locator('[data-group]').nth(0).getByTestId('group-tabbar').boundingBox())!;
  const second = (await page.locator('[data-group]').nth(1).getByTestId('group-tabbar').boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + 250, { steps: 8 });
  await expect(page.getByTestId('drop-compass')).toHaveCount(1);
  await expect(page.getByTestId('drop-compass').locator('.ad-compass-button')).toHaveCount(5);
  const firstId = await page.getByTestId('drop-compass').getAttribute('data-group');
  // and it moves to the other pane with the pointer
  await page.mouse.move(second.x + second.width / 2, second.y + 250, { steps: 8 });
  await expect.poll(async () => page.getByTestId('drop-compass').getAttribute('data-group')).not.toBe(firstId);
  await page.mouse.up();
});

test('pointing at the right button of the compass splits to the right of that pane', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(2);
  await waitForEditor(page, 40_000);
  const from = (await sessionTabs(page).nth(1).boundingBox())!;
  const ws = (await page.getByTestId('workspace').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 40, { steps: 5 });
  await page.mouse.move(ws.x + ws.width / 2, ws.y + ws.height / 2, { steps: 10 });
  const buttons = page.getByTestId('drop-compass').locator('.ad-compass-button');
  await expect(buttons).toHaveCount(5);
  const right = (await buttons.nth(3).boundingBox())!; // top, left, middle, right, bottom
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2, { steps: 6 });
  await expect(page.getByTestId('drop-highlight')).toHaveAttribute('data-target', /"zone":"right"/);
  await expect(buttons.nth(3)).toHaveAttribute('data-active', 'true');
  await page.mouse.up();
  await expect(page.locator('[data-group]')).toHaveCount(2);
});

test('with one pane there are no buttons on the window\'s edges', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(2);
  await waitForEditor(page, 40_000);
  const from = (await sessionTabs(page).nth(1).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 40, { steps: 5 });
  await expect(page.getByTestId('drag-layer')).toBeVisible();
  await expect(page.getByTestId('drop-edge-button')).toHaveCount(0);
  await page.mouse.up();
});

test('the left half of a pane splits it to the left, without aiming at its edge', async ({ ad }) => {
  const { page } = ad;
  await waitForEditor(page);
  await page.keyboard.press('Control+Shift+T');
  await expect(sessionTabs(page)).toHaveCount(2);
  await waitForEditor(page, 40_000);
  const from = (await sessionTabs(page).nth(1).boundingBox())!;
  const body = (await page.locator('[data-group-body]').first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 40, { steps: 5 });
  // 20 % in from the left, halfway down: well inside the pane, outside the middle box (which is 30-70 %)
  await page.mouse.move(body.x + body.width * 0.2, body.y + body.height / 2, { steps: 10 });
  const hl = page.getByTestId('drop-highlight');
  await expect(hl).toHaveAttribute('data-target', /"zone":"left"/);
  await expect.poll(async () => Math.round((await hl.boundingBox())!.width)).toBeLessThan(Math.round(body.width * 0.55));
  await expect.poll(async () => Math.round((await hl.boundingBox())!.width)).toBeGreaterThan(Math.round(body.width * 0.4)); // about half of the pane
  // and the middle of the pane joins as a tab
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2, { steps: 10 });
  await expect(hl).toHaveAttribute('data-target', /"zone":"center"/);
  await page.mouse.up();
});
