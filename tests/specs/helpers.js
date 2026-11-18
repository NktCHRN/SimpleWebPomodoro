// Shared fixtures and helpers.
//
// Every test page gets:
//  - a fake clock paused at T0 (advance it with page.clock.runFor / fastForward);
//  - mocks that record what the app does with things a headless browser can't
//    really do: notifications, sound, screen wake lock, tab visibility.
//    Read the records with rec(page).
const { test: base, expect } = require('@playwright/test');
const path = require('path');

const APP_DIR = path.resolve(process.env.APP_DIR || path.join(__dirname, '..', '..', 'src'));
const KEY = 'pomodoro.v1';
const T0 = Date.parse('2026-03-02T09:00:00.000Z');
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

const DEFAULT_SETTINGS = { pomodoro: 25, short: 5, long: 15, cyclesBeforeLong: 4, autoStart: false, keepAwake: true, volume: 40, sound: 'marimba' };
const DEFAULT_STATE = {
  mode: 'pomodoro', remaining: 25 * 60, completed: 0, total: 0,
  running: false, endAt: null, lastActive: T0
};

// Runs in the page before the app (serialized by Playwright).
function installMocks(cfg) {
  const rec = (window.__rec = {
    notes: [], permRequests: 0, audioContexts: 0, sounds: [],
    wake: { requests: 0, releases: 0, active: 0 }
  });

  // Notifications (constructor path)
  let permission = cfg.permission;
  class FakeNotification {
    constructor(title, options = {}) {
      rec.notes.push({ title, ...options, via: 'constructor' });
      this.onclick = null;
    }
    close() {}
    static get permission() { return permission; }
    static requestPermission() {
      rec.permRequests++;
      return Promise.resolve(permission);
    }
  }
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });

  // Notifications (service worker path)
  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, options = {}) {
      rec.notes.push({ title, ...options, via: 'sw' });
      return Promise.resolve();
    };
  }

  // Sound: rec.sounds gets one entry per sound played (the app reads
  // currentTime once per sound), holding its notes as { f, type, peak }.
  // cfg.audio === 'suspended': like a real browser before any interaction,
  // a new context starts suspended until resume() is called.
  rec.audioResumes = 0;
  class FakeAudioContext {
    constructor() {
      rec.audioContexts++;
      this.state = cfg.audio === 'suspended' ? 'suspended' : 'running';
      this.destination = {};
    }
    get currentTime() {
      rec.sounds.push([]);
      return 0;
    }
    createOscillator() {
      const osc = {
        type: 'sine',
        gainNode: null,
        frequency: { value: 0, setValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime() {} },
        connect(n) { osc.gainNode = n; return n; },
        start() {
          rec.sounds[rec.sounds.length - 1].push({
            f: osc.frequency.value, type: osc.type, peak: osc.gainNode ? osc.gainNode.peak : 0
          });
        },
        stop() {}
      };
      return osc;
    }
    createGain() {
      const node = {
        peak: 0,
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime(v) { if (v > node.peak) node.peak = v; }
        },
        connect: (n) => n
      };
      return node;
    }
    resume() {
      rec.audioResumes++;
      this.state = 'running';
      return Promise.resolve();
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;

  // Screen Wake Lock
  window.__sentinels = [];
  if (cfg.wakeLock === 'unsupported') {
    delete Navigator.prototype.wakeLock;
  } else {
    const wakeLock = {
      request(type) {
        rec.wake.requests++;
        if (cfg.wakeLock === 'reject') return Promise.reject(new DOMException('denied', 'NotAllowedError'));
        const s = new EventTarget();
        s.type = type;
        s.released = false;
        s.release = () => {
          if (!s.released) {
            s.released = true;
            rec.wake.releases++;
            rec.wake.active--;
            s.dispatchEvent(new Event('release'));
          }
          return Promise.resolve();
        };
        rec.wake.active++;
        window.__sentinels.push(s);
        return Promise.resolve(s);
      }
    };
    Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => wakeLock, configurable: true });
  }

  // cfg.neverClicked: behave like a tab the user never interacted with
  // (Playwright pages otherwise report user activation).
  if (cfg.neverClicked && navigator.userActivation) {
    Object.defineProperty(navigator, 'userActivation', {
      value: { hasBeenActive: false, isActive: false }, configurable: true
    });
  }

  // Tab visibility, controllable from tests
  window.__vis = 'visible';
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => window.__vis, configurable: true });
  Object.defineProperty(Document.prototype, 'hidden', { get: () => window.__vis !== 'visible', configurable: true });
}

const test = base.extend({
  // Override per file/describe with test.use({ mockConfig: {...} })
  mockConfig: [{ permission: 'granted', wakeLock: 'ok' }, { option: true }],
  page: async ({ page, mockConfig }, use) => {
    await page.addInitScript(installMocks, mockConfig);
    await page.clock.install({ time: T0 - SEC });
    await page.clock.pauseAt(T0);
    await use(page);
  }
});

// Put saved data in localStorage before the app loads (first load only, so a
// reload sees what the app itself saved).
async function seed(page, { settings = {}, state = {} } = {}) {
  const data = { settings: { ...DEFAULT_SETTINGS, ...settings }, state: { ...DEFAULT_STATE, ...state } };
  await page.addInitScript(({ key, data }) => {
    if (!sessionStorage.getItem('__seeded')) {
      localStorage.setItem(key, JSON.stringify(data));
      sessionStorage.setItem('__seeded', '1');
    }
  }, { key: KEY, data });
}

const open = (page) => page.goto('/index.html');
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
// Alerts go through a Web Lock (one alert across tabs), which the browser
// grants asynchronously. A lock query is answered after earlier requests have
// been handled, so awaiting it first means pending alerts have fired.
const rec = (page) => page.evaluate(async () => {
  if (navigator.locks) await navigator.locks.query();
  await Promise.resolve();
  return window.__rec;
});

// Simulate switching away from / back to the tab. Like a real browser, hiding
// the page drops any held wake lock.
async function setVisibility(page, v) {
  await page.evaluate((v) => {
    window.__vis = v;
    if (v === 'hidden') window.__sentinels.forEach((s) => s.release());
    document.dispatchEvent(new Event('visibilitychange'));
  }, v);
}

const ui = (page) => ({
  timer: page.locator('#timer'),
  startStop: page.locator('#startStopBtn'),
  skip: page.locator('#skipBtn'),
  resetCurrent: page.locator('#resetCurrentBtn'),
  resetSession: page.locator('#resetAllBtn'),
  cycleText: page.locator('#cycleText'),
  dots: page.locator('#dots .dot'),
  total: page.locator('#sessionTotal'),
  body: page.locator('body'),
  settingsSummary: page.locator('#settings summary'),
  input: (name) => page.locator(`#${name}Input`),
  save: page.locator('#settingsForm button[type=submit]'),
  defaults: page.locator('#defaultsBtn'),
  switchLabel: (id) => page.locator(`label:has(#${id})`),
  sound: page.locator('#soundInput'),
  soundPreview: page.locator('#soundPreviewBtn'),
  volume: page.locator('#volumeInput'),
  volumeValue: page.locator('#volumeValue'),
  autoStart: page.locator('#autoStartInput'),
  keepAwake: page.locator('#keepAwakeInput')
});

module.exports = {
  test, expect, seed, open, stored, rec, setVisibility, ui, installMocks,
  APP_DIR, KEY, T0, SEC, MIN, HOUR, DEFAULT_SETTINGS, DEFAULT_STATE
};
