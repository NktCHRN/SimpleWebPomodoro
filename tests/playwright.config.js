// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: true,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'msedge',          // use the installed Edge, no browser download
    headless: true,
    serviceWorkers: 'block',    // notifications use the (mocked) constructor; SW tests opt in
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } }
    },
    {
      // Layout checks again at phone size, plus touch-only checks.
      name: 'phone',
      testMatch: /(layout|touch)\.spec\.js/,
      use: { ...devices['Pixel 7'], channel: 'msedge' }
    }
  ]
});
