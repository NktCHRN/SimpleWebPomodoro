// localStorage persistence, last active time, catch-up after being away,
// and the 12-hour automatic session reset.
const { test, expect, seed, open, stored, rec, setVisibility, ui, T0, SEC, MIN, HOUR } = require('./helpers');

test.describe('Persistence across reloads', () => {
  test('reloading a running timer pauses it where it was and waits for Start', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(1 * MIN);
    await page.reload();
    await expect(u.startStop).toHaveText('Start');
    await expect(u.timer).toHaveText('24:00');
    await page.clock.runFor(1 * MIN);
    await expect(u.timer).toHaveText('24:00'); // not counting
    expect((await stored(page)).state).toMatchObject({ running: false, remaining: 1440, endAt: null });
    await u.startStop.click();
    await page.clock.runFor(1 * SEC);
    await expect(u.timer).toHaveText('23:59');
  });

  test('a stopped timer keeps its time after reload', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(90 * SEC);
    await u.startStop.click();
    await page.reload();
    await expect(u.startStop).toHaveText('Start');
    await expect(u.timer).toHaveText('23:30');
  });

  test('step, cycle and session total survive reload', async ({ page }) => {
    await seed(page, { state: { completed: 2, total: 6 } });
    await open(page);
    const u = ui(page);
    await u.skip.click();
    await page.reload();
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.cycleText).toHaveText('3 of 4 done');
    await expect(u.total).toHaveText('Pomodoros this session: 7');
  });

  test('corrupted saved data falls back to defaults', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('__seeded')) {
        localStorage.setItem('pomodoro.v1', '{not json');
        sessionStorage.setItem('__seeded', '1');
      }
    });
    await open(page);
    await expect(ui(page).timer).toHaveText('25:00');
  });
});

test.describe('Last active time', () => {
  test('is refreshed about every 5 s while running', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    expect((await stored(page)).state.lastActive).toBe(T0);
    await page.clock.runFor(6 * SEC);
    const last = (await stored(page)).state.lastActive;
    expect(last).toBeGreaterThanOrEqual(T0 + 5 * SEC);
    expect(last).toBeLessThanOrEqual(T0 + 6 * SEC);
  });

  test('an open but stopped tab never changes it, even across reload', async ({ page }) => {
    await seed(page, { state: { lastActive: T0 - HOUR } });
    await open(page);
    await page.clock.runFor(10 * MIN);
    expect((await stored(page)).state.lastActive).toBe(T0 - HOUR);
    await page.reload();
    expect((await stored(page)).state.lastActive).toBe(T0 - HOUR);
  });

  test('Stop records the stop time', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(3 * SEC);
    await u.startStop.click();
    expect((await stored(page)).state.lastActive).toBe(T0 + 3 * SEC);
  });
});

test.describe('Reopening after all tabs were closed', () => {
  // Closed `closedMinAgo` minutes ago while running, with `leftMin` minutes
  // left at that moment (lastActive = the save made when closing).
  const closed = (closedMinAgo, leftMin) => ({
    running: true, remaining: 1500,
    lastActive: T0 - closedMinAgo * MIN,
    endAt: T0 - closedMinAgo * MIN + leftMin * MIN
  });

  test('shows the time left at closing, paused, silently', async ({ page }) => {
    await seed(page, { state: closed(60, 20) });
    await open(page);
    const u = ui(page);
    await expect(u.startStop).toHaveText('Start');
    await expect(u.timer).toHaveText('20:00');
    await expect(u.body).toHaveClass('mode-pomodoro');
    const r = await rec(page);
    expect(r.sounds).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });

  test('saves the paused state; last stop = when it was closed', async ({ page }) => {
    await seed(page, { state: closed(60, 20) });
    await open(page);
    await page.clock.runFor(1 * SEC); // past the "is another tab open?" wait
    expect((await stored(page)).state).toMatchObject({
      running: false, endAt: null, remaining: 1200, lastActive: T0 - 60 * MIN
    });
  });

  test('Start continues from the paused time', async ({ page }) => {
    await seed(page, { state: closed(60, 20) });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(1 * MIN);
    await expect(u.timer).toHaveText('19:00');
  });

  test('a step that had already ended before closing is moved past (auto-start off)', async ({ page }) => {
    // e.g. a frozen phone tab: the step ended 30 min before the page was closed
    await seed(page, { state: { running: true, remaining: 1500, lastActive: T0 - 60 * MIN, endAt: T0 - 90 * MIN } });
    await open(page);
    const u = ui(page);
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.timer).toHaveText('05:00');
    await expect(u.startStop).toHaveText('Start');
    await expect(u.total).toHaveText('Pomodoros this session: 1');
    expect((await rec(page)).sounds).toHaveLength(0);
  });

  test('with auto-start, the schedule is replayed up to closing, then paused', async ({ page }) => {
    // P ended 80 min ago, S ran 80→75, next P ran from 75 min ago; closed 60 min ago
    await seed(page, { settings: { autoStart: true }, state: { running: true, remaining: 1500, lastActive: T0 - 60 * MIN, endAt: T0 - 80 * MIN } });
    await open(page);
    const u = ui(page);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.timer).toHaveText('10:00');
    await expect(u.cycleText).toHaveText('2 of 4');
    await expect(u.startStop).toHaveText('Start');
  });

  test('closed 13 h ago → session reset', async ({ page }) => {
    await seed(page, { state: { ...closed(13 * 60, 20), completed: 2, total: 2 } });
    await open(page);
    await page.clock.runFor(1 * SEC);
    const u = ui(page);
    await expect(u.total).toHaveText('Pomodoros this session: 0');
    await expect(u.timer).toHaveText('25:00');
    await expect(u.startStop).toHaveText('Start');
  });

  test('closed 11 h ago → kept, paused', async ({ page }) => {
    await seed(page, { state: { ...closed(11 * 60, 20), completed: 2, total: 2 } });
    await open(page);
    await page.clock.runFor(1 * SEC);
    await expect(ui(page).total).toHaveText('Pomodoros this session: 2');
    await expect(ui(page).timer).toHaveText('20:00');
  });

  test('pressing Start right away (during the open-tab check) wins', async ({ page }) => {
    await seed(page, { state: closed(60, 20) });
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(1 * SEC);
    await expect(ui(page).startStop).toHaveText('Stop');
    await expect(ui(page).timer).toHaveText('19:59');
  });
});

test.describe('Catch-up after the page was paused (phone locked / frozen tab)', () => {
  test('auto-start on: schedule kept, one alert describing where we are now', async ({ page }) => {
    await seed(page, { settings: { autoStart: true } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    // fastForward fires due timers at most once, like a page that was asleep
    await page.clock.fastForward(40 * MIN);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.timer).toHaveText('15:00');
    await expect(u.startStop).toHaveText('Stop');
    const r = await rec(page);
    expect(r.sounds).toHaveLength(1);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ title: 'Short break finished!', body: 'Pomodoro started.' });
  });

  test('auto-start off: next step waits; last stop = actual end time', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.fastForward(40 * MIN);
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.startStop).toHaveText('Start');
    expect((await rec(page)).notes[0]).toMatchObject({ body: 'Time for a short break.' });
    expect((await stored(page)).state.lastActive).toBe(T0 + 25 * MIN);
  });
});

test.describe('12-hour automatic reset', () => {
  const busy = { mode: 'short', remaining: 120, completed: 2, total: 5 };

  test('opening 13 h after the last stop resets the session', async ({ page }) => {
    await seed(page, { state: { ...busy, lastActive: T0 - 13 * HOUR } });
    await open(page);
    const u = ui(page);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.timer).toHaveText('25:00');
    await expect(u.cycleText).toHaveText('1 of 4');
    await expect(u.total).toHaveText('Pomodoros this session: 0');
    const r = await rec(page);
    expect(r.sounds).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });

  test('opening 11 h after the last stop keeps everything', async ({ page }) => {
    await seed(page, { state: { ...busy, lastActive: T0 - 11 * HOUR } });
    await open(page);
    const u = ui(page);
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.timer).toHaveText('02:00');
    await expect(u.total).toHaveText('Pomodoros this session: 5');
  });

  test('settings are kept by the reset', async ({ page }) => {
    await seed(page, { settings: { pomodoro: 40, autoStart: true }, state: { ...busy, lastActive: T0 - 13 * HOUR } });
    await open(page);
    await expect(ui(page).timer).toHaveText('40:00');
    expect((await stored(page)).settings).toMatchObject({ pomodoro: 40, autoStart: true });
  });

  test('a tab left open and visible resets via the once-a-minute check', async ({ page }) => {
    await seed(page, { state: { ...busy, lastActive: T0 - 12 * HOUR + 30 * SEC } });
    await open(page);
    const u = ui(page);
    await expect(u.total).toHaveText('Pomodoros this session: 5');
    await page.clock.runFor(61 * SEC);
    await expect(u.total).toHaveText('Pomodoros this session: 0');
    await expect(u.body).toHaveClass('mode-pomodoro');
  });

  test('coming back to a hidden tab after 12 h resets it', async ({ page }) => {
    await seed(page, { state: { ...busy, lastActive: T0 - 11 * HOUR } });
    await open(page);
    const u = ui(page);
    await setVisibility(page, 'hidden');
    await page.clock.setSystemTime(T0 + 2 * HOUR); // time passes, no timers fire
    await setVisibility(page, 'visible');
    await expect(u.total).toHaveText('Pomodoros this session: 0');
  });

  test('the minute check never resets a running timer', async ({ page }) => {
    await seed(page, { settings: { pomodoro: 180 }, state: { remaining: 180 * 60, completed: 2, total: 5, lastActive: T0 - 11 * HOUR } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(2 * HOUR + 30 * MIN);
    await expect(u.startStop).toHaveText('Stop');
    await expect(u.total).toHaveText('Pomodoros this session: 5');
  });
});
