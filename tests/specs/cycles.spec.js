// Step transitions, long breaks, counters, dots, Skip and Auto-start.
const { test, expect, seed, open, stored, rec, ui, T0, SEC, MIN } = require('./helpers');

const NOTE = { tag: 'pomodoro', renotify: true, icon: 'icons/icon-192.png' };

test.describe('Step transitions', () => {
  test('pomodoro end → short break (stopped), sound + notification', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(25 * MIN);
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.timer).toHaveText('05:00');
    await expect(u.startStop).toHaveText('Start');
    await expect(u.cycleText).toHaveText('1 of 4 done');
    await expect(u.total).toHaveText('Pomodoros this session: 1');
    const r = await rec(page);
    expect(r.sounds).toHaveLength(1);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ title: 'Pomodoro finished!', body: 'Time for a short break.', ...NOTE });
    expect((await stored(page)).state).toMatchObject({ mode: 'short', completed: 1, total: 1, running: false });
  });

  test('short break end → next pomodoro', async ({ page }) => {
    await seed(page, { state: { mode: 'short', remaining: 300, completed: 1, total: 1 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(5 * MIN);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.timer).toHaveText('25:00');
    await expect(u.cycleText).toHaveText('2 of 4');
    const r = await rec(page);
    expect(r.notes[0]).toMatchObject({ title: 'Short break finished!', body: 'Break is over — time to focus.' });
  });

  test('4th pomodoro → long break', async ({ page }) => {
    await seed(page, { state: { completed: 3, total: 3 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(25 * MIN);
    await expect(u.body).toHaveClass('mode-long');
    await expect(u.timer).toHaveText('15:00');
    await expect(u.cycleText).toHaveText('4 of 4 done');
    await expect(page.locator('#dots .dot.done')).toHaveCount(4);
    expect((await rec(page)).notes[0]).toMatchObject({ title: 'Pomodoro finished!', body: 'Time for a long break.' });
  });

  test('long break end → new set (cycle count resets, session total does not)', async ({ page }) => {
    await seed(page, { state: { mode: 'long', remaining: 900, completed: 4, total: 4 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(15 * MIN);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.cycleText).toHaveText('1 of 4');
    await expect(u.total).toHaveText('Pomodoros this session: 4');
    expect((await stored(page)).state).toMatchObject({ completed: 0, total: 4 });
    expect((await rec(page)).notes[0]).toMatchObject({ title: 'Long break finished!', body: 'Break is over — time to focus.' });
  });

  test('session total keeps counting into the next set', async ({ page }) => {
    await seed(page, { state: { mode: 'long', remaining: 900, completed: 4, total: 4 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(15 * MIN);
    await u.startStop.click();
    await page.clock.runFor(25 * MIN);
    await expect(u.total).toHaveText('Pomodoros this session: 5');
    await expect(u.cycleText).toHaveText('1 of 4 done');
  });

  test('a full set with a custom cycle count (2) and custom lengths', async ({ page }) => {
    await seed(page, {
      settings: { pomodoro: 1, short: 2, long: 3, cyclesBeforeLong: 2 },
      state: { remaining: 60 }
    });
    await open(page);
    const u = ui(page);
    const step = async (ms, mode, time) => {
      await u.startStop.click();
      await page.clock.runFor(ms);
      await expect(u.body).toHaveClass(`mode-${mode}`);
      await expect(u.timer).toHaveText(time);
    };
    await expect(u.dots).toHaveCount(2);
    await step(1 * MIN, 'short', '02:00');
    await step(2 * MIN, 'pomodoro', '01:00');
    await step(1 * MIN, 'long', '03:00');
    await expect(u.cycleText).toHaveText('2 of 2 done');
    await step(3 * MIN, 'pomodoro', '01:00');
    await expect(u.cycleText).toHaveText('1 of 2');
    await expect(u.total).toHaveText('Pomodoros this session: 2');
  });

  test('dots show completed and current cycles', async ({ page }) => {
    await seed(page, { state: { completed: 2, total: 2 } });
    await open(page);
    const dots = ui(page).dots;
    await expect(dots).toHaveCount(4);
    await expect(dots.nth(0)).toHaveClass(/done/);
    await expect(dots.nth(1)).toHaveClass(/done/);
    await expect(dots.nth(2)).toHaveClass(/current/);
    await expect(dots.nth(3)).toHaveClass('dot');
  });
});

test.describe('Skip', () => {
  test('skipping a pomodoro counts it and goes to the break, silently', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.skip.click();
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.timer).toHaveText('05:00');
    await expect(u.startStop).toHaveText('Start');
    await expect(u.total).toHaveText('Pomodoros this session: 1');
    const r = await rec(page);
    expect(r.sounds).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });

  test('skipping while running stops on the next step', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(10 * SEC);
    await u.skip.click();
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.startStop).toHaveText('Start');
    await page.clock.runFor(5 * SEC);
    await expect(u.timer).toHaveText('05:00');
  });

  test('skipping a short break goes to the next pomodoro without counting', async ({ page }) => {
    await seed(page, { state: { mode: 'short', remaining: 300, completed: 1, total: 1 } });
    await open(page);
    const u = ui(page);
    await u.skip.click();
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.cycleText).toHaveText('2 of 4');
    await expect(u.total).toHaveText('Pomodoros this session: 1');
  });

  test('skipping the 4th pomodoro goes to the long break', async ({ page }) => {
    await seed(page, { state: { completed: 3, total: 3 } });
    await open(page);
    await ui(page).skip.click();
    await expect(ui(page).body).toHaveClass('mode-long');
  });

  test('skipping a long break starts a new set', async ({ page }) => {
    await seed(page, { state: { mode: 'long', remaining: 900, completed: 4, total: 4 } });
    await open(page);
    const u = ui(page);
    await u.skip.click();
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.cycleText).toHaveText('1 of 4');
    expect((await stored(page)).state.completed).toBe(0);
  });
});

test.describe('Auto-start next step', () => {
  test('is off by default', async ({ page }) => {
    await open(page);
    await expect(ui(page).autoStart).not.toBeChecked();
  });

  test('pomodoro end starts the short break automatically', async ({ page }) => {
    await seed(page, { settings: { autoStart: true } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(25 * MIN);
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.startStop).toHaveText('Stop');
    await page.clock.runFor(1 * SEC);
    await expect(u.timer).toHaveText('04:59');
    const r = await rec(page);
    expect(r.sounds).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ title: 'Pomodoro finished!', body: 'Short break started.' });
  });

  test('short break end starts the next pomodoro automatically', async ({ page }) => {
    await seed(page, { settings: { autoStart: true }, state: { mode: 'short', remaining: 300, completed: 1, total: 1 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(5 * MIN);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.startStop).toHaveText('Stop');
    expect((await rec(page)).notes[0]).toMatchObject({ body: 'Pomodoro started.' });
  });

  test('4th pomodoro end starts the long break automatically', async ({ page }) => {
    await seed(page, { settings: { autoStart: true }, state: { completed: 3, total: 3 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(25 * MIN);
    await expect(u.body).toHaveClass('mode-long');
    await expect(u.startStop).toHaveText('Stop');
    expect((await rec(page)).notes[0]).toMatchObject({ body: 'Long break started.' });
  });

  test('a new set never starts automatically (after the long break it waits)', async ({ page }) => {
    await seed(page, { settings: { autoStart: true }, state: { mode: 'long', remaining: 900, completed: 4, total: 4 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(15 * MIN);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.startStop).toHaveText('Start');
    await page.clock.runFor(1 * MIN);
    await expect(u.timer).toHaveText('25:00');
    expect((await rec(page)).notes[0]).toMatchObject({
      title: 'Long break finished!', body: 'Set complete. Press Start to begin the next set.'
    });
  });

  test('chains several steps until the end of the set', async ({ page }) => {
    await seed(page, { settings: { autoStart: true, pomodoro: 1, short: 1, long: 1, cyclesBeforeLong: 2 }, state: { remaining: 60 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    // P(1) S(1) P(1) L(1) then wait
    await page.clock.runFor(4 * MIN + 10 * SEC);
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.startStop).toHaveText('Start');
    await expect(u.total).toHaveText('Pomodoros this session: 2');
    expect((await rec(page)).notes.map((n) => n.body)).toEqual([
      'Short break started.', 'Pomodoro started.', 'Long break started.', 'Set complete. Press Start to begin the next set.'
    ]);
  });

  test('Skip with auto-start starts the next step from now', async ({ page }) => {
    await seed(page, { settings: { autoStart: true } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(10 * SEC);
    await u.skip.click();
    await expect(u.body).toHaveClass('mode-short');
    await expect(u.startStop).toHaveText('Stop');
    expect((await stored(page)).state.endAt).toBe(T0 + 10 * SEC + 5 * MIN);
    await page.clock.runFor(1 * SEC);
    await expect(u.timer).toHaveText('04:59');
  });

  test('Skip of a long break with auto-start still waits', async ({ page }) => {
    await seed(page, { settings: { autoStart: true }, state: { mode: 'long', remaining: 900, completed: 4, total: 4 } });
    await open(page);
    const u = ui(page);
    await u.skip.click();
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.startStop).toHaveText('Start');
  });
});
