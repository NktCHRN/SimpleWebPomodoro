// Exactly one sound + notification per step end, whatever the user did before.
const { test, expect, seed, open, stored, rec, ui, installMocks, SEC, MIN } = require('./helpers');

const alertsOf = async (page) => {
  const r = await rec(page);
  return { notes: r.notes.length, sounds: r.sounds.length };
};

test.describe('No duplicate alerts', () => {
  test('Start → Stop → Start gives one alert', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(10 * SEC);
    await u.startStop.click();
    await u.startStop.click();
    await page.clock.runFor(25 * MIN);
    expect(await alertsOf(page)).toEqual({ notes: 1, sounds: 1 });
  });

  test('many quick Start/Stop clicks still give one alert', async ({ page }) => {
    await open(page);
    const u = ui(page);
    for (let i = 0; i < 9; i++) await u.startStop.click(); // ends running
    await expect(u.startStop).toHaveText('Stop');
    await page.clock.runFor(25 * MIN + 5 * SEC);
    expect(await alertsOf(page)).toEqual({ notes: 1, sounds: 1 });
  });

  test('reloading mid-step gives one alert', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(5 * MIN);
    await page.reload();
    await ui(page).startStop.click(); // a reload pauses; continue
    await page.clock.runFor(1 * MIN);
    await page.reload();
    await ui(page).startStop.click();
    await page.clock.runFor(19 * MIN + 5 * SEC);
    expect(await alertsOf(page)).toEqual({ notes: 1, sounds: 1 });
  });

  test('Skip right before the end does not also fire the old step’s alert', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(25 * MIN - 100);
    await u.skip.click();
    await page.clock.runFor(1 * MIN);
    expect(await alertsOf(page)).toEqual({ notes: 0, sounds: 0 });
  });

  test('both end-of-step triggers firing gives one alert', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    // jump past the end: the interval tick and the one-off timeout are both due
    await page.clock.fastForward(26 * MIN);
    await page.clock.runFor(1 * SEC);
    expect(await alertsOf(page)).toEqual({ notes: 1, sounds: 1 });
  });

  test('auto-start chain: one alert per step, none repeated', async ({ page }) => {
    await seed(page, { settings: { autoStart: true } });
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(25 * MIN + 5 * MIN + 1 * SEC);
    expect(await alertsOf(page)).toEqual({ notes: 2, sounds: 2 });
  });

  test('two tabs open while running: one alert in total', async ({ page, context, mockConfig }) => {
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(1 * MIN);

    const second = await context.newPage();
    await second.addInitScript(installMocks, mockConfig);
    await open(second);
    await expect(ui(second).startStop).toHaveText('Stop');

    await page.clock.runFor(24 * MIN + 5 * SEC);
    const a = await alertsOf(page);
    const b = await alertsOf(second);
    expect({ notes: a.notes + b.notes, sounds: a.sounds + b.sounds }).toEqual({ notes: 1, sounds: 1 });
  });
});

async function secondTab(context, mockConfig) {
  const p = await context.newPage();
  await p.addInitScript(installMocks, mockConfig);
  await open(p);
  return p;
}

// Playwright's fake clock advances one tab after the other, so a single long
// runFor would let one tab live through the whole period before the other
// moves at all. Advancing in small steps keeps the tabs within a fraction of a
// second of each other, like real time.
// realPauseMs gives cross-tab messages (storage events) real time to arrive
// between steps, as they would in a real browser.
async function advanceTogether(page, ms, step = 250, realPauseMs = 0) {
  for (let t = 0; t < ms; t += step) {
    await page.clock.runFor(Math.min(step, ms - t));
    if (realPauseMs) await page.waitForTimeout(realPauseMs);
  }
}

test.describe('Sound comes from the tab you clicked in', () => {
  // Tab A: clicked (can play sound). Tab B: opened later, never clicked.
  // Whichever tab's countdown reaches the end first, A must be the one that
  // alerts. The start offset varies so both orders happen across runs.
  for (let run = 1; run <= 6; run++) {
    test(`clicked tab A alerts, unclicked tab B stays quiet (run ${run})`, async ({ page, context, mockConfig }) => {
      await open(page);
      await ui(page).startStop.click();
      await page.clock.runFor(run * 41);
      const second = await context.newPage();
      await second.addInitScript(installMocks, { ...mockConfig, neverClicked: true });
      await open(second);
      await expect(ui(second).startStop).toHaveText('Stop');

      await page.clock.runFor(25 * MIN - 3 * SEC);
      await advanceTogether(page, 8 * SEC);
      const a = await alertsOf(page);
      const b = await alertsOf(second);
      expect(a).toEqual({ notes: 1, sounds: 1 });
      expect(b).toEqual({ notes: 0, sounds: 0 });
      await expect(ui(page).body).toHaveClass('mode-short');
      await expect(ui(second).body).toHaveClass('mode-short');
    });
  }

  // The race: the unclicked tab B reaches the end first, so the clicked tab A
  // only learns about it through the sync (its own countdown is stopped by the
  // synced state). A must still take over the alert, because only A may play sound.
  test('clicked tab still alerts when the unclicked tab finishes first', async ({ page, context, mockConfig }) => {
    await open(page);
    const second = await context.newPage();
    await second.addInitScript(installMocks, { ...mockConfig, neverClicked: true });
    await open(second);
    await ui(second).startStop.click();        // B's ticks line up with the step end
    await page.clock.runFor(100);
    await page.reload();                       // A's ticks are now 100 ms off
    await expect(ui(page).startStop).toHaveText('Stop');

    await page.clock.runFor(25 * MIN - 100 - 1 * SEC);
    await advanceTogether(page, 2 * SEC, 10, 15); // B finishes at the exact end
    await page.clock.runFor(5 * SEC);          // past B's 1.5 s fallback
    const a = await alertsOf(page);
    const b = await alertsOf(second);
    expect(a).toEqual({ notes: 1, sounds: 1 });
    expect(b).toEqual({ notes: 0, sounds: 0 });
  });
});

test.describe('Several tabs stay in sync', () => {
  test('Start in one tab starts the other', async ({ page, context, mockConfig }) => {
    await open(page);
    const second = await secondTab(context, mockConfig);
    await ui(page).startStop.click();
    await expect(ui(second).startStop).toHaveText('Stop');
    await page.clock.runFor(1 * MIN);
    await expect(ui(second).timer).toHaveText('24:00');
  });

  test('Skip and progress show up in the other tab', async ({ page, context, mockConfig }) => {
    await open(page);
    const second = await secondTab(context, mockConfig);
    await ui(page).skip.click();
    await expect(ui(second).body).toHaveClass('mode-short');
    await expect(ui(second).cycleText).toHaveText('1 of 4 done');
    await expect(ui(second).total).toHaveText('Pomodoros this session: 1');
  });

  test('settings changed in one tab apply in the other', async ({ page, context, mockConfig }) => {
    await open(page);
    const second = await secondTab(context, mockConfig);
    await ui(page).settingsSummary.click();
    await ui(page).input('pomodoro').fill('30');
    await ui(page).save.click();
    await ui(page).switchLabel('autoStartInput').click();
    await expect(ui(second).timer).toHaveText('30:00');
    await expect(ui(second).input('pomodoro')).toHaveValue('30');
    await expect(ui(second).autoStart).toBeChecked();
  });

  test('typing in one tab is not overwritten while the other tab’s timer runs', async ({ page, context, mockConfig }) => {
    await open(page);
    await ui(page).startStop.click();
    const second = await secondTab(context, mockConfig);
    await ui(second).settingsSummary.click();
    await ui(second).input('short').fill('9');
    await page.clock.runFor(30 * SEC); // the running tab saves every ~5 s
    await expect(ui(second).input('short')).toHaveValue('9');
  });

  test('auto-start chain across two tabs: one alert per step', async ({ page, context, mockConfig }) => {
    await seed(page, { settings: { autoStart: true } });
    await open(page);
    await ui(page).startStop.click();
    const second = await secondTab(context, mockConfig);
    await page.clock.runFor(25 * MIN + 5 * MIN + 5 * SEC);
    const a = await alertsOf(page);
    const b = await alertsOf(second);
    expect({ notes: a.notes + b.notes, sounds: a.sounds + b.sounds }).toEqual({ notes: 2, sounds: 2 });
    await expect(ui(second).body).toHaveClass('mode-pomodoro');
    await expect(ui(second).startStop).toHaveText('Stop');
  });

  test('reloading one tab while another is open keeps the timer running', async ({ page, context, mockConfig }) => {
    await open(page);
    await ui(page).startStop.click();
    const second = await secondTab(context, mockConfig);
    await page.clock.runFor(1 * MIN);
    await second.reload();
    await expect(ui(second).startStop).toHaveText('Stop');
    await page.clock.runFor(2 * SEC);
    await expect(ui(page).startStop).toHaveText('Stop');   // the other tab was not paused
    await expect(ui(second).timer).toHaveText('23:58');
    expect((await stored(page)).state.running).toBe(true);
  });

  test('a new tab opened while another runs follows it, not paused', async ({ page, context, mockConfig }) => {
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(1 * MIN);
    const second = await secondTab(context, mockConfig);
    await page.clock.runFor(2 * SEC);
    await expect(ui(second).startStop).toHaveText('Stop');
    await expect(ui(second).timer).toHaveText('23:58');
    await expect(ui(page).startStop).toHaveText('Stop');
  });

  test('closing all tabs and opening one again: paused where it was', async ({ page, context, mockConfig }) => {
    await open(page);
    await ui(page).startStop.click();
    const second = await secondTab(context, mockConfig);
    await page.clock.runFor(5 * MIN);
    await second.close();
    await page.close({ runBeforeUnload: true });
    const again = await context.newPage();
    await again.addInitScript(installMocks, mockConfig);
    await open(again);
    await expect(ui(again).startStop).toHaveText('Start');
    await expect(ui(again).timer).toHaveText('20:00');
  });

  test('Stop in one tab stops the other, and it stays stopped after reload', async ({ page, context, mockConfig }) => {
    await open(page);
    await ui(page).startStop.click();
    const second = await context.newPage();
    await second.addInitScript(installMocks, mockConfig);
    await open(second);
    await page.clock.runFor(1 * MIN);

    await ui(page).startStop.click(); // stop in the first tab
    await expect(ui(second).startStop).toHaveText('Start');
    await page.clock.runFor(10 * SEC); // the second tab must not save "running" again
    await page.reload();
    await expect(ui(page).startStop).toHaveText('Start');
    await expect(ui(page).timer).toHaveText('24:00');
  });
});
