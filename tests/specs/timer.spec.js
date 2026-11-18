// Start / Stop / Reset current / Reset session and the countdown display.
const { test, expect, seed, open, stored, ui, T0, SEC, MIN } = require('./helpers');

test.describe('Timer controls', () => {
  test('first visit shows the defaults', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await expect(u.timer).toHaveText('25:00');
    await expect(u.startStop).toHaveText('Start');
    await expect(u.cycleText).toHaveText('1 of 4');
    await expect(u.total).toHaveText('Pomodoros this session: 0');
    await expect(u.dots).toHaveCount(4);
    await expect(page).toHaveTitle('25:00 · Pomodoro');
    await expect(u.body).toHaveClass('mode-pomodoro');
  });

  test('Start counts down and updates the tab title', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await expect(u.startStop).toHaveText('Stop');
    await page.clock.runFor(1 * SEC);
    await expect(u.timer).toHaveText('24:59');
    await page.clock.runFor(59 * SEC);
    await expect(u.timer).toHaveText('24:00');
    await expect(page).toHaveTitle('24:00 · Pomodoro');
  });

  test('partial seconds round up (no 24:59 until a full second passed)', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(700);
    await expect(u.timer).toHaveText('25:00');
    await page.clock.runFor(300);
    await expect(u.timer).toHaveText('24:59');
  });

  test('Stop pauses; Start resumes from the same point', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(10 * SEC);
    await u.startStop.click();
    await expect(u.startStop).toHaveText('Start');
    await expect(u.timer).toHaveText('24:50');

    await page.clock.runFor(1 * MIN);
    await expect(u.timer).toHaveText('24:50');
    const s = await stored(page);
    expect(s.state.running).toBe(false);
    expect(s.state.remaining).toBeCloseTo(1490, 3);
    expect(s.state.endAt).toBeNull();

    await u.startStop.click();
    await page.clock.runFor(10 * SEC);
    await expect(u.timer).toHaveText('24:40');
  });

  test('Reset current restores the full step length and keeps the cycle', async ({ page }) => {
    await seed(page, { state: { completed: 2, total: 2 } });
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(90 * SEC);
    await u.resetCurrent.click();
    await expect(u.timer).toHaveText('25:00');
    await expect(u.startStop).toHaveText('Start');
    await expect(u.cycleText).toHaveText('3 of 4');
    const s = await stored(page);
    expect(s.state).toMatchObject({ mode: 'pomodoro', completed: 2, total: 2, running: false, remaining: 1500 });
  });

  test('Reset current on a break restores the break length', async ({ page }) => {
    await seed(page, { state: { mode: 'short', remaining: 120, completed: 1, total: 1 } });
    await open(page);
    const u = ui(page);
    await expect(u.timer).toHaveText('02:00');
    await u.resetCurrent.click();
    await expect(u.timer).toHaveText('05:00');
    await expect(u.body).toHaveClass('mode-short');
  });

  test('Reset session asks for confirmation; Cancel changes nothing', async ({ page }) => {
    await seed(page, { state: { mode: 'short', remaining: 100, completed: 2, total: 6 } });
    await open(page);
    const u = ui(page);
    let message = '';
    page.once('dialog', (d) => { message = d.message(); d.dismiss(); });
    await u.resetSession.click();
    expect(message).toContain('Reset the session?');
    await expect(u.timer).toHaveText('01:40');
    await expect(u.total).toHaveText('Pomodoros this session: 6');
  });

  test('Reset session (confirmed) clears cycles and the session total', async ({ page }) => {
    await seed(page, { state: { mode: 'short', remaining: 100, completed: 2, total: 6 } });
    await open(page);
    const u = ui(page);
    page.once('dialog', (d) => d.accept());
    await u.resetSession.click();
    await expect(u.body).toHaveClass('mode-pomodoro');
    await expect(u.timer).toHaveText('25:00');
    await expect(u.cycleText).toHaveText('1 of 4');
    await expect(u.total).toHaveText('Pomodoros this session: 0');
    const s = await stored(page);
    expect(s.state).toMatchObject({ completed: 0, total: 0, running: false, lastActive: T0 });
  });

  test('Reset session stops a running timer', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(5 * SEC);
    page.once('dialog', (d) => d.accept());
    await u.resetSession.click();
    await expect(u.startStop).toHaveText('Start');
    await page.clock.runFor(5 * SEC);
    await expect(u.timer).toHaveText('25:00');
  });
});
