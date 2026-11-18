// Unit tests for sw.js, run in Node with a fake service worker global.
// (A headless browser can't show or click notifications.)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, expect } = require('@playwright/test');
const { APP_DIR } = require('./helpers');

function loadWorker({ windows = [] } = {}) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0, opened: [], matchAllOptions: null };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { calls.skipWaiting++; return Promise.resolve(); },
    clients: {
      claim: () => { calls.claim++; return Promise.resolve(); },
      matchAll: (opts) => { calls.matchAllOptions = opts; return Promise.resolve(windows); },
      openWindow: (url) => { calls.opened.push(url); return Promise.resolve({}); }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(APP_DIR, 'sw.js'), 'utf8'), { self });
  return { listeners, calls };
}

function fakeEvent() {
  const e = { waited: null, notification: { closed: false, close() { this.closed = true; } } };
  e.waitUntil = (p) => { e.waited = p; };
  return e;
}

test.describe('sw.js', () => {
  test('activates immediately and takes control of open pages', async () => {
    const { listeners, calls } = loadWorker();
    listeners.install({});
    expect(calls.skipWaiting).toBe(1);
    const e = fakeEvent();
    listeners.activate(e);
    await e.waited;
    expect(calls.claim).toBe(1);
  });

  test('has no fetch handler (no caching, page loads normally)', () => {
    const { listeners } = loadWorker();
    expect(listeners.fetch).toBeUndefined();
  });

  test('tapping a notification closes it and focuses the open timer', async () => {
    let focused = 0;
    const { listeners, calls } = loadWorker({ windows: [{ focus: () => { focused++; return Promise.resolve(); } }] });
    const e = fakeEvent();
    listeners.notificationclick(e);
    await e.waited;
    expect(e.notification.closed).toBe(true);
    expect(focused).toBe(1);
    expect(calls.opened).toEqual([]);
    expect(calls.matchAllOptions).toEqual({ type: 'window', includeUncontrolled: true });
  });

  test('tapping a notification reopens the timer if it was closed', async () => {
    const { listeners, calls } = loadWorker({ windows: [] });
    const e = fakeEvent();
    listeners.notificationclick(e);
    await e.waited;
    expect(calls.opened).toEqual(['./']);
  });
});
