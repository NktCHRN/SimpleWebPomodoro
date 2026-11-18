// Notifications (constructor and service worker paths), permission and sound.
const { test, expect, seed, open, stored, rec, ui, SEC, MIN } = require('./helpers');

const loudest = (sound) => Math.max(...sound.map((n) => n.peak));

test.describe('Notification permission and sound', () => {
  test.describe('permission not decided yet', () => {
    test.use({ mockConfig: { permission: 'default', wakeLock: 'ok' } });
    test('is requested on Start', async ({ page }) => {
      await open(page);
      expect((await rec(page)).permRequests).toBe(0);
      await ui(page).startStop.click();
      expect((await rec(page)).permRequests).toBe(1);
    });
  });

  test('is not requested again once granted', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    expect((await rec(page)).permRequests).toBe(0);
  });

  test.describe('permission denied', () => {
    test.use({ mockConfig: { permission: 'denied', wakeLock: 'ok' } });
    test('no notification, but the sound still plays', async ({ page }) => {
      await open(page);
      await ui(page).startStop.click();
      await page.clock.runFor(25 * MIN);
      const r = await rec(page);
      expect(r.notes).toHaveLength(0);
      expect(r.sounds).toHaveLength(1);
    });
  });

  test('audio is unlocked by the Start click (one AudioContext, reused)', async ({ page }) => {
    await open(page);
    expect((await rec(page)).audioContexts).toBe(0);
    await ui(page).startStop.click();
    expect((await rec(page)).audioContexts).toBe(1);
    await page.clock.runFor(25 * MIN);
    await ui(page).startStop.click();
    await page.clock.runFor(5 * MIN);
    const r = await rec(page);
    expect(r.audioContexts).toBe(1);
    expect(r.sounds).toHaveLength(2);
  });

  test('default sound is Marimba (C–E–G–C) at 40% volume', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(25 * MIN);
    const [sound] = (await rec(page)).sounds;
    expect(sound.filter((n) => n.peak > 0.1).map((n) => n.f)).toEqual([523.3, 659.3, 784, 1046.5]);
    expect(loudest(sound)).toBeCloseTo(0.4 * 0.8, 5);
  });

  test('sound loudness follows the volume setting', async ({ page }) => {
    await seed(page, { settings: { volume: 75 } });
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(25 * MIN);
    expect(loudest((await rec(page)).sounds[0])).toBeCloseTo(0.75 * 0.8, 5);
  });

  test('volume 0 plays nothing, but the notification is still shown', async ({ page }) => {
    await seed(page, { settings: { volume: 0 } });
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(25 * MIN);
    const r = await rec(page);
    expect(r.sounds).toHaveLength(0);
    expect(r.notes).toHaveLength(1);
  });

  test('letting go of the volume slider plays a test sound at the new level', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.volume.focus();
    await page.keyboard.press('ArrowLeft'); // keyboard fires input + change
    const r = await rec(page);
    expect(r.sounds).toHaveLength(1);
    expect(loudest(r.sounds[0])).toBeCloseTo(0.35 * 0.8, 5);
    expect(r.notes).toHaveLength(0);
  });

  test('dragging the volume slider to 0 plays no test sound', async ({ page }) => {
    await seed(page, { settings: { volume: 5 } });
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.volume.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(u.volumeValue).toHaveText('0%');
    expect((await rec(page)).sounds).toHaveLength(0);
  });

  test('without a service worker, notifications use the Notification constructor', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(25 * MIN);
    expect((await rec(page)).notes[0].via).toBe('constructor');
  });

  test('the end-of-step timeout fires the alert on time', async ({ page }) => {
    await seed(page, { settings: { pomodoro: 1 }, state: { remaining: 60 } });
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(60 * SEC - 1);
    expect((await rec(page)).notes).toHaveLength(0);
    await page.clock.runFor(51); // interval tick or the one-off +50 ms timeout
    expect((await rec(page)).notes).toHaveLength(1);
  });
});

test.describe('Sound picker', () => {
  const ALL = [
    ['marimba', 'Marimba'], ['beep', 'Triple beep'], ['dingdong', 'Ding-dong'], ['bowl', 'Singing bowl'],
    ['kitchen', 'Kitchen timer'], ['alarm', 'Digital alarm'], ['rise', 'Soft rise'], ['sparkle', 'Sparkle']
  ];

  test('lists all 8 sounds with Marimba selected by default', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await expect(u.sound).toHaveValue('marimba');
    const options = await u.sound.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
    expect(options).toEqual(ALL);
  });

  test('picking a sound plays it, applies without Save and persists', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.sound.selectOption('beep');
    const [preview] = (await rec(page)).sounds;
    expect(preview.map((n) => n.f)).toEqual([880, 880, 1046]);
    expect((await stored(page)).settings.sound).toBe('beep');
    await page.reload();
    await expect(u.sound).toHaveValue('beep');
  });

  test('the chosen sound is played when a step ends', async ({ page }) => {
    await seed(page, { settings: { sound: 'alarm' } });
    await open(page);
    await ui(page).startStop.click();
    await page.clock.runFor(25 * MIN);
    const [sound] = (await rec(page)).sounds;
    expect(sound).toHaveLength(6);
    expect(sound.every((n) => n.type === 'square' && n.f === 1975)).toBe(true);
  });

  test('▶ replays the current sound', async ({ page }) => {
    await seed(page, { settings: { sound: 'rise' } });
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.soundPreview.click();
    await u.soundPreview.click();
    const r = await rec(page);
    expect(r.sounds).toHaveLength(2);
    expect(r.sounds[0].map((n) => n.f)).toEqual([740, 988]);
    expect(r.notes).toHaveLength(0);
  });

  test('▶ does not submit the settings form', async ({ page }) => {
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.input('pomodoro').fill('30');
    await u.soundPreview.click();
    await expect(u.timer).toHaveText('25:00');
  });

  test('Save keeps the sound; Defaults resets it to Marimba', async ({ page }) => {
    await seed(page, { settings: { sound: 'bowl' } });
    await open(page);
    const u = ui(page);
    await u.settingsSummary.click();
    await u.save.click();
    expect((await stored(page)).settings.sound).toBe('bowl');
    await u.defaults.click();
    await expect(u.sound).toHaveValue('marimba');
    expect((await stored(page)).settings.sound).toBe('marimba');
  });

  test('an unknown saved sound falls back to Marimba', async ({ page }) => {
    await seed(page, { settings: { sound: 'trumpet' } });
    await open(page);
    const u = ui(page);
    await expect(u.sound).toHaveValue('marimba');
    await u.startStop.click();
    await page.clock.runFor(25 * MIN);
    expect((await rec(page)).sounds[0][0].f).toBe(523.3);
  });

  for (const [id, name] of ALL) {
    test(`${name} plays notes and never exceeds the volume`, async ({ page }) => {
      await seed(page, { settings: { sound: id, volume: 100 } });
      await open(page);
      await ui(page).settingsSummary.click();
      await ui(page).soundPreview.click();
      const [sound] = (await rec(page)).sounds;
      expect(sound.length).toBeGreaterThan(0);
      expect(loudest(sound)).toBeGreaterThan(0);
      expect(loudest(sound)).toBeLessThanOrEqual(1);
      expect(sound.every((n) => n.f > 20 && n.f < 20000)).toBe(true);
    });
  }
});

test.describe('Service worker (served from localhost)', () => {
  test.use({ serviceWorkers: 'allow' });

  test('sw.js registers and becomes active', async ({ page }) => {
    await open(page);
    const scriptURL = await page.evaluate(async () => (await navigator.serviceWorker.ready).active.scriptURL);
    expect(scriptURL).toMatch(/\/sw\.js$/);
  });

  test('notifications go through the service worker when it is active', async ({ page }) => {
    await open(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await ui(page).startStop.click();
    await page.clock.runFor(25 * MIN);
    const r = await rec(page);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({
      via: 'sw', title: 'Pomodoro finished!', body: 'Time for a short break.',
      tag: 'pomodoro', renotify: true, icon: 'icons/icon-192.png'
    });
  });
});
