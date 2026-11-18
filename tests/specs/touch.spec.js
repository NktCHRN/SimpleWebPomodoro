// Phones: taps (touch events, no mouse) must unlock sound and drive the timer.
// Runs in the "phone" project (Pixel 7 emulation with touch).
const { test, expect, open, rec, ui, installMocks, SEC, MIN } = require('./helpers');

test.use({ mockConfig: { permission: 'granted', wakeLock: 'ok', audio: 'suspended' } });

test.describe('Touch', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch-only checks');
  });

  test('tapping Start starts the timer and unlocks sound', async ({ page }) => {
    await open(page);
    await ui(page).startStop.tap();
    await expect(ui(page).startStop).toHaveText('Stop');
    await expect.poll(async () => (await rec(page)).audioContexts).toBe(1);
    await page.clock.runFor(25 * MIN);
    const r = await rec(page);
    expect(r.sounds).toHaveLength(1);
    expect(r.notes).toHaveLength(1);
  });

  test('after a reload, the timer waits; tapping Start continues and unlocks sound', async ({ page }) => {
    await open(page);
    await ui(page).startStop.tap();
    await page.clock.runFor(1 * MIN);
    await page.reload();
    expect((await rec(page)).audioContexts).toBe(0);
    await expect(ui(page).startStop).toHaveText('Start');
    await expect(ui(page).timer).toHaveText('24:00');
    await ui(page).startStop.tap();
    await expect.poll(async () => (await rec(page)).audioContexts).toBe(1);
    await page.clock.runFor(24 * MIN + 1 * SEC);
    expect((await rec(page)).sounds).toHaveLength(1);
  });

  test('Skip, Settings and the switches work by tapping', async ({ page }) => {
    await open(page);
    await ui(page).skip.tap();
    await expect(ui(page).body).toHaveClass('mode-short');
    await ui(page).settingsSummary.tap();
    await ui(page).switchLabel('autoStartInput').tap();
    await expect(ui(page).autoStart).toBeChecked();
    await ui(page).soundPreview.tap();
    expect((await rec(page)).sounds).toHaveLength(1);
  });
});
