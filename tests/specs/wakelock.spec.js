// "Keep screen on" (Screen Wake Lock API).
const { test, expect, seed, open, rec, setVisibility, ui, SEC, MIN } = require('./helpers');

const wake = async (page) => (await rec(page)).wake;

test.describe('Keep screen on', () => {
  test('is on by default; Start acquires a screen lock, Stop releases it', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await expect(u.keepAwake).toBeChecked();
    expect((await wake(page)).requests).toBe(0);
    await u.startStop.click();
    await expect.poll(async () => (await wake(page)).active).toBe(1);
    await u.startStop.click();
    await expect.poll(async () => (await wake(page)).active).toBe(0);
    expect((await wake(page)).releases).toBe(1);
  });

  test('turning the switch off while running releases; on re-acquires', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await expect.poll(async () => (await wake(page)).active).toBe(1);
    await u.settingsSummary.click();
    await u.switchLabel('keepAwakeInput').click();
    await expect.poll(async () => (await wake(page)).active).toBe(0);
    await u.switchLabel('keepAwakeInput').click();
    await expect.poll(async () => (await wake(page)).active).toBe(1);
    expect((await wake(page)).requests).toBe(2);
  });

  test('with the switch off, Start does not request a lock', async ({ page }) => {
    await seed(page, { settings: { keepAwake: false } });
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(1 * SEC);
    expect((await wake(page)).requests).toBe(0);
  });

  test('hiding the tab drops the lock; coming back re-acquires it', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    await expect.poll(async () => (await wake(page)).active).toBe(1);
    await setVisibility(page, 'hidden');
    await expect.poll(async () => (await wake(page)).active).toBe(0);
    await setVisibility(page, 'visible');
    await expect.poll(async () => (await wake(page)).active).toBe(1);
    expect((await wake(page)).requests).toBe(2);
  });

  test('step end without auto-start releases the lock', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    await expect.poll(async () => (await wake(page)).active).toBe(1);
    await page.clock.runFor(25 * MIN);
    await expect.poll(async () => (await wake(page)).active).toBe(0);
  });

  test('with auto-start the same lock is kept into the next step', async ({ page }) => {
    await seed(page, { settings: { autoStart: true } });
    await open(page);
    await ui(page).startStop.click();
    await expect.poll(async () => (await wake(page)).active).toBe(1);
    await page.clock.runFor(25 * MIN + 1 * SEC);
    await expect(ui(page).body).toHaveClass('mode-short');
    const w = await wake(page);
    expect(w.active).toBe(1);
    expect(w.requests).toBe(1);
  });

  test('Reset current releases the lock', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    await expect.poll(async () => (await wake(page)).active).toBe(1);
    await ui(page).resetCurrent.click();
    await expect.poll(async () => (await wake(page)).active).toBe(0);
  });

  test.describe('browser without wake lock support', () => {
    test.use({ mockConfig: { permission: 'granted', wakeLock: 'unsupported' } });
    test('switch is disabled and faded; the timer still works', async ({ page }) => {
      await open(page);
      const u = ui(page);
      await expect(u.keepAwake).toBeDisabled();
      await expect(u.keepAwake).not.toBeChecked();
      await expect(u.switchLabel('keepAwakeInput')).toHaveClass(/unsupported/);
      await expect(u.switchLabel('keepAwakeInput')).toHaveAttribute('title', 'Not supported in this browser');
      await u.startStop.click();
      await page.clock.runFor(1 * SEC);
      await expect(u.timer).toHaveText('24:59');
    });
  });

  test.describe('lock request refused (e.g. battery saver)', () => {
    test.use({ mockConfig: { permission: 'granted', wakeLock: 'reject' } });
    // Regression: a refusal used to be retried in a tight loop that froze the page.
    test('the timer still works and the request is not retried in a loop', async ({ page }) => {
      await open(page);
      const u = ui(page);
      await u.startStop.click();
      await page.clock.runFor(1 * SEC);
      await expect(u.timer).toHaveText('24:59');
      expect((await wake(page)).requests).toBe(1);
    });

    test('asks again after Stop/Start or after coming back to the tab', async ({ page }) => {
      await open(page);
      const u = ui(page);
      await u.startStop.click();
      await u.startStop.click();
      await u.startStop.click();
      await expect.poll(async () => (await wake(page)).requests).toBe(2);
      await setVisibility(page, 'hidden');
      await setVisibility(page, 'visible');
      await expect.poll(async () => (await wake(page)).requests).toBe(3);
    });
  });
});
