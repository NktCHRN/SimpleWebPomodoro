// Settings panel: lengths, cycle count, validation, Defaults, switches.
const { test, expect, seed, open, stored, ui, T0, SEC, MIN, HOUR, DEFAULT_SETTINGS } = require('./helpers');

async function setField(page, name, value) {
  await ui(page).input(name).fill(String(value));
}

test.describe('Settings', () => {
  test('form shows the current settings', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await expect(u.input('pomodoro')).toHaveValue('25');
    await expect(u.input('short')).toHaveValue('5');
    await expect(u.input('long')).toHaveValue('15');
    await expect(u.input('cycles')).toHaveValue('4');
    await expect(u.autoStart).not.toBeChecked();
    await expect(u.keepAwake).toBeChecked();
  });

  test('Save updates an untouched current step and persists across reload', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await setField(page, 'pomodoro', 30);
    await u.save.click();
    await expect(u.timer).toHaveText('30:00');
    expect((await stored(page)).settings.pomodoro).toBe(30);
    await page.reload();
    await expect(u.timer).toHaveText('30:00');
    await expect(u.input('pomodoro')).toHaveValue('30');
  });

  test('Save does not change a started step; the next step uses the new length', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(1 * MIN);
    await u.startStop.click();
    await u.settingsSummary.click();
    await setField(page, 'pomodoro', 40);
    await setField(page, 'short', 7);
    await u.save.click();
    await expect(u.timer).toHaveText('24:00');
    await u.skip.click();
    await expect(u.timer).toHaveText('07:00');
  });

  test('Save while running keeps the countdown going', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.startStop.click();
    await page.clock.runFor(1 * MIN);
    await u.settingsSummary.click();
    await setField(page, 'pomodoro', 50);
    await u.save.click();
    await expect(u.startStop).toHaveText('Stop');
    await page.clock.runFor(1 * SEC);
    await expect(u.timer).toHaveText('23:59');
  });

  test('changing the break length updates an untouched break', async ({ page }) => {
    await seed(page, { state: { mode: 'long', remaining: 900, completed: 4, total: 4 } });
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await setField(page, 'long', 20);
    await u.save.click();
    await expect(u.timer).toHaveText('20:00');
  });

  test('pomodoros before long break changes the text and dots', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await setField(page, 'cycles', 6);
    await u.save.click();
    await expect(u.cycleText).toHaveText('1 of 6');
    await expect(u.dots).toHaveCount(6);
  });

  for (const [field, bad] of [['pomodoro', 0], ['pomodoro', 181], ['short', 61], ['long', 121], ['cycles', 13], ['pomodoro', 2.5], ['pomodoro', '']]) {
    test(`invalid value ${field}=${JSON.stringify(bad)} is rejected by the form`, async ({ page }) => {
      await open(page);
      const u = ui(page);
      await u.settingsSummary.click();
      await setField(page, field, bad);
      await u.save.click();
      expect(await u.input(field).evaluate((el) => el.validity.valid)).toBe(false);
      await expect(u.timer).toHaveText('25:00');
      expect(await stored(page)).toBeNull(); // nothing was saved
    });
  }

  test('Defaults restores every setting, including both switches', async ({ page }) => {
    await seed(page, {
      settings: { pomodoro: 50, short: 10, long: 30, cyclesBeforeLong: 2, autoStart: true, keepAwake: false },
      state: { remaining: 3000 }
    });
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.defaults.click();
    await expect(u.input('pomodoro')).toHaveValue('25');
    await expect(u.input('short')).toHaveValue('5');
    await expect(u.input('long')).toHaveValue('15');
    await expect(u.input('cycles')).toHaveValue('4');
    await expect(u.autoStart).not.toBeChecked();
    await expect(u.keepAwake).toBeChecked();
    await expect(u.timer).toHaveText('25:00');
    expect((await stored(page)).settings).toEqual(DEFAULT_SETTINGS);
  });

  test('Save keeps the switch values', async ({ page }) => {
    await seed(page, { settings: { autoStart: true, keepAwake: false } });
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await setField(page, 'pomodoro', 20);
    await u.save.click();
    expect((await stored(page)).settings).toMatchObject({ pomodoro: 20, autoStart: true, keepAwake: false });
    await expect(u.autoStart).toBeChecked();
    await expect(u.keepAwake).not.toBeChecked();
  });

  test('switches apply instantly (no Save) and persist across reload', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.switchLabel('autoStartInput').click();
    await u.switchLabel('keepAwakeInput').click();
    expect((await stored(page)).settings).toMatchObject({ autoStart: true, keepAwake: false });
    await page.reload();
    await expect(u.autoStart).toBeChecked();
    await expect(u.keepAwake).not.toBeChecked();
  });

  test('volume slider starts at 40%', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await expect(u.volume).toHaveValue('40');
    await expect(u.volumeValue).toHaveText('40%');
    await expect(u.volume).toHaveAttribute('min', '0');
    await expect(u.volume).toHaveAttribute('max', '100');
    await expect(u.volume).toHaveAttribute('step', '5');
  });

  test('volume changes with the keyboard in steps of 5, applies without Save and persists', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.volume.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(u.volumeValue).toHaveText('50%');
    expect((await stored(page)).settings.volume).toBe(50);
    await page.reload();
    await expect(u.volume).toHaveValue('50');
    await expect(u.volumeValue).toHaveText('50%');
  });

  test('Save keeps the volume; Defaults resets it to 40%', async ({ page }) => {
    await seed(page, { settings: { volume: 80 } });
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await setField(page, 'pomodoro', 20);
    await u.save.click();
    expect((await stored(page)).settings.volume).toBe(80);
    await u.defaults.click();
    await expect(u.volumeValue).toHaveText('40%');
    expect((await stored(page)).settings.volume).toBe(40);
  });

  test('saving settings counts as activity (restarts the 12h count)', async ({ page }) => {
    await seed(page, { state: { lastActive: T0 - 2 * HOUR } });
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.save.click();
    expect((await stored(page)).state.lastActive).toBe(T0);
  });
});
