// localStorage persistence, last active time, catch-up after being away,
// and the 12-hour automatic session reset.
const { test, expect, seed, open, stored, rec, setVisibility, ui, T0, SEC, MIN, HOUR } = require('./helpers');

test.describe('Persistence across reloads', () => {
  test('a running timer keeps running after reload', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(1 * MIN);
    await page.reload();
    await expect(u.startStop).toHaveText('Stop');
    await expect(u.timer).toHaveText('24:00');
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

test.describe('Catch-up after the page was closed', () => {
  const ended = (minutesAgo) => ({ running: true, endAt: T0 - minutesAgo * MIN, remaining: 1500, lastActive: T0 - 30 * MIN });

  test('auto-start on, 15 min late → 2nd pomodoro with 15:00 left, silently', async ({ page }) => {
    await seed(page, { settings: { autoStart: true }, state: ended(15) });
    await open(page);
    const u = ui(page);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.startStop).toHaveText('Stop');
    await expect(u.timer).toHaveText('15:00');
    await expect(u.cycleText).toHaveText('2 of 4');
    await expect(u.total).toHaveText('Pomodoros this session: 1');
    const r = await rec(page);
    expect(r.sounds).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });

  test('auto-start off, 15 min late → break waiting; last stop = when the pomodoro ended', async ({ page }) => {
    await seed(page, { state: ended(15) });
    await open(page);
    const u = ui(page);
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.startStop).toHaveText('Start');
    await expect(u.timer).toHaveText('05:00');
    expect((await stored(page)).state.lastActive).toBe(T0 - 15 * MIN);
  });

  test('auto-start on, 3 h late → whole set replayed, waits at the new set', async ({ page }) => {
    await seed(page, { settings: { autoStart: true }, state: ended(180) });
    await open(page);
    const u = ui(page);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.startStop).toHaveText('Start');
    await expect(u.cycleText).toHaveText('1 of 4');
    await expect(u.total).toHaveText('Pomodoros this session: 4');
    // 1st pomodoro ended 180 min ago; S+P+S+P+S+P+L = 105 min later the set ended
    expect((await stored(page)).state.lastActive).toBe(T0 - 75 * MIN);
  });

  test('auto-start on, ended 14 h ago → replayed set ended 12h+ ago → session reset', async ({ page }) => {
    await seed(page, { settings: { autoStart: true }, state: ended(14 * 60) });
    await open(page);
    const u = ui(page);
    await expect(u.total).toHaveText('Pomodoros this session: 0');
    await expect(u.timer).toHaveText('25:00');
    await expect(u.startStop).toHaveText('Start');
  });

  test('auto-start off, ended 13 h ago → session reset', async ({ page }) => {
    await seed(page, { state: { ...ended(13 * 60), completed: 2, total: 2 } });
    await open(page);
    await expect(ui(page).total).toHaveText('Pomodoros this session: 0');
    await expect(ui(page).body).toHaveClass('mode-pomodoro');
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

  test('a running timer is never auto-reset', async ({ page }) => {
    await seed(page, { state: { running: true, endAt: T0 + 10 * MIN, completed: 2, total: 5, lastActive: T0 - 13 * HOUR } });
    await open(page);
    const u = ui(page);
    await expect(u.startStop).toHaveText('Stop');
    await expect(u.total).toHaveText('Pomodoros this session: 5');
    await page.clock.runFor(2 * MIN);
    await expect(u.total).toHaveText('Pomodoros this session: 5');
  });
});
