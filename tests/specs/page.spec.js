// Leave-page confirmation, colours, <head> metadata, assets, header sizing.
const fs = require('fs');
const path = require('path');
const { test, expect, seed, open, ui, APP_DIR, SEC } = require('./helpers');

test.describe('Leave-page confirmation', () => {
  test('asks to confirm closing while the timer runs', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    let type = null;
    page.on('dialog', (d) => { type = d.type(); d.dismiss(); });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => type).toBe('beforeunload');
    expect(page.isClosed()).toBe(false);
  });

  test('closes without asking when the timer is stopped', async ({ page }) => {
    await open(page);
    await ui(page).startStop.click();
    await ui(page).startStop.click();
    let type = null;
    page.on('dialog', (d) => { type = d.type(); d.dismiss(); });
    const closed = page.waitForEvent('close');
    await page.close({ runBeforeUnload: true });
    await closed;
    expect(type).toBeNull();
  });
});

test.describe('Colours per step', () => {
  const cases = [
    ['pomodoro', 1500, 'rgb(217, 83, 79)', '#d9534f'],
    ['short', 300, 'rgb(42, 157, 143)', '#2a9d8f'],
    ['long', 900, 'rgb(58, 110, 165)', '#3a6ea5']
  ];
  for (const [mode, remaining, bg, theme] of cases) {
    test(`${mode}: background, browser bar colour and active label`, async ({ page }) => {
      await seed(page, { state: { mode, remaining, completed: mode === 'long' ? 4 : 1, total: 1 } });
      await open(page);
      await expect(ui(page).body).toHaveCSS('background-color', bg);
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme);
      await expect(page.locator('.mode-label.active')).toHaveAttribute('data-mode', mode);
      await expect(page.locator('.mode-label.active')).toHaveCount(1);
    });
  }

  test('colour changes when the step changes', async ({ page }) => {
    await open(page);
    await ui(page).skip.click();
    await expect(ui(page).body).toHaveCSS('background-color', 'rgb(42, 157, 143)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#2a9d8f');
  });
});

test.describe('Head metadata and assets', () => {
  test('links the favicon, phone icon, manifest and theme colour', async ({ page }) => {
    await open(page);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'logo.svg');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'icons/apple-touch-icon.png');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Pomodoro');
    await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
  });

  for (const asset of ['logo.svg', 'icon.svg', 'sw.js', 'style.css', 'app.js', 'manifest.webmanifest']) {
    test(`serves ${asset}`, async ({ request }) => {
      expect((await request.get(`/${asset}`)).status()).toBe(200);
    });
  }

  test('manifest is valid and its icons exist with the declared sizes', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'Pomodoro Timer', short_name: 'Pomodoro', display: 'standalone', start_url: './' });
    for (const icon of manifest.icons) {
      const res = await request.get(`/${icon.src}`);
      expect(res.status()).toBe(200);
      const png = await res.body();
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w, h]);
    }
  });

  test('apple-touch-icon is 180×180', async () => {
    const png = fs.readFileSync(path.join(APP_DIR, 'icons', 'apple-touch-icon.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180]);
  });
});

test.describe('Header and controls sizing', () => {
  test('title is 2rem with a 36px logo on a white disc', async ({ page }) => {
    await open(page);
    await expect(page.locator('h1')).toHaveCSS('font-size', '32px');
    const logo = page.locator('h1 img.logo');
    await expect(logo).toHaveCSS('width', '36px');
    await expect(logo).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  });

  test('switches are 48×26', async ({ page }) => {
    await open(page);
    await ui(page).settingsSummary.click();
    const box = await page.locator('label:has(#autoStartInput) .switch').boundingBox();
    expect(Math.round(box.width)).toBe(48);
    expect(Math.round(box.height)).toBe(26);
  });

  test('Skip uses a slightly larger font (0.95rem)', async ({ page }) => {
    await open(page);
    await expect(ui(page).skip).toHaveCSS('font-size', '15.2px');
  });
});
