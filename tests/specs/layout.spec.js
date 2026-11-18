// Layout: cycle text centred, Skip beside it spanning text + dots,
// no horizontal scroll. Runs on desktop and phone (see playwright.config.js).
const { test, expect, seed, open, ui } = require('./helpers');

const center = (b) => b.x + b.width / 2;

const modes = [
  ['pomodoro', { mode: 'pomodoro', remaining: 1500, completed: 1, total: 1 }],
  ['short break', { mode: 'short', remaining: 300, completed: 1, total: 1 }],
  ['long break', { mode: 'long', remaining: 900, completed: 4, total: 4 }]
];

test.describe('Layout', () => {
  for (const [name, state] of modes) {
    test(`${name}: cycle text and dots are centred; Skip sits right, as tall as text + dots`, async ({ page }) => {
      await seed(page, { state });
      await open(page);
      const u = ui(page);
      const card = await page.locator('.app').boundingBox();
      const text = await u.cycleText.boundingBox();
      const dots = await page.locator('#dots').boundingBox();
      const skip = await u.skip.boundingBox();

      expect(Math.abs(center(text) - center(card))).toBeLessThanOrEqual(1);
      expect(Math.abs(center(dots) - center(card))).toBeLessThanOrEqual(1);

      // the visible text itself (not just its grid cell) is centred
      const inner = await u.cycleText.evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const b = r.getBoundingClientRect();
        return { x: b.x, width: b.width };
      });
      expect(Math.abs(center(inner) - center(card))).toBeLessThanOrEqual(1);

      expect(skip.x).toBeGreaterThanOrEqual(inner.x + inner.width);
      expect(skip.x + skip.width).toBeLessThanOrEqual(card.x + card.width);
      expect(Math.abs(skip.y - text.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(skip.y + skip.height - (dots.y + dots.height))).toBeLessThanOrEqual(1);
    });
  }

  test('12 dots wrap instead of running into Skip', async ({ page }) => {
    await seed(page, { settings: { cyclesBeforeLong: 12 } });
    await open(page);
    const dots = await page.locator('#dots').boundingBox();
    const skip = await ui(page).skip.boundingBox();
    const lastDot = await page.locator('#dots .dot').last().boundingBox();
    expect(lastDot.x + lastDot.width).toBeLessThanOrEqual(skip.x);
    expect(dots.x + dots.width).toBeLessThanOrEqual(skip.x);
  });

  test('no horizontal scrolling', async ({ page }) => {
    await open(page);
    await ui(page).settingsSummary.click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('Settings switches line up with the number fields (label left, control right)', async ({ page }) => {
    await open(page);
    await ui(page).settingsSummary.click();
    const field = await ui(page).input('pomodoro').boundingBox();
    const sw = await page.locator('label:has(#keepAwakeInput) .switch').boundingBox();
    expect(Math.abs(field.x + field.width - (sw.x + sw.width))).toBeLessThanOrEqual(1);
  });

  test('sound dropdown and ▶ fit in the row, right-aligned with the fields', async ({ page }) => {
    await open(page);
    await ui(page).settingsSummary.click();
    const field = await ui(page).input('pomodoro').boundingBox();
    const select = await ui(page).sound.boundingBox();
    const play = await ui(page).soundPreview.boundingBox();
    expect(select.x + select.width).toBeLessThanOrEqual(play.x);
    expect(Math.abs(field.x + field.width - (play.x + play.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(select.y + select.height / 2 - (play.y + play.height / 2))).toBeLessThanOrEqual(1);
  });

  test('volume slider and its % value fit in the row, right-aligned with the fields', async ({ page }) => {
    await open(page);
    await ui(page).settingsSummary.click();
    const field = await ui(page).input('pomodoro').boundingBox();
    const slider = await ui(page).volume.boundingBox();
    const value = await ui(page).volumeValue.boundingBox();
    const label = await page.locator('label.volume-row').boundingBox();
    expect(slider.x + slider.width).toBeLessThanOrEqual(value.x);
    expect(Math.abs(field.x + field.width - (value.x + value.width))).toBeLessThanOrEqual(1);
    expect(slider.height).toBeLessThanOrEqual(label.height);
  });
});
