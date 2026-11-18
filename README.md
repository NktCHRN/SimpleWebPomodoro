# Pomodoro Timer

A simple Pomodoro timer that runs entirely in the browser. Plain HTML, CSS and JavaScript: no frameworks, no build step, no server, no database.

## Features

- **Pomodoro, short break and long break**, each with its own colour (25 / 5 / 15 min by default, long break after 4 pomodoros — all adjustable).
- **Start / Stop**, **Skip** to the next step, **Reset current** step and **Reset session**.
- **Progress**: "2 of 4" with dots for the current set, plus a count of pomodoros this session.
- **Sound and notification** at the end of every step. 8 generated sounds to choose from (Marimba by default) with a volume slider — no audio files.
- **Auto-start next step** (optional). A new set always waits for Start.
- **Keep screen on** while the timer runs (Screen Wake Lock API), so phones don't sleep mid-pomodoro.
- **Remembers everything** in `localStorage`: settings, current step, time left, progress.
- **Pauses when closed**: closing the last tab (or reloading) freezes the timer at that moment; opening the site again shows the time that was left and waits for Start. That first click also allows the browser to play sound. If another tab is still open, the timer keeps running there and new tabs follow it.
- **Keeps to the clock** while open: if the tab was paused in the background (e.g. phone locked), it catches up from when each step actually ended.
- **12-hour reset**: if the timer has been stopped for more than 12 hours, the session starts over automatically.
- **Several tabs, one timer**: tabs stay in sync (start, stop, skip, settings), and each step end is announced only once.
- **Installable on phones** (web app manifest, icons) with notifications through a service worker.
- Asks before closing the tab while the timer is running.

## Project structure

```
src/                     the app — deploy this folder as-is
├── index.html
├── style.css
├── app.js               all timer logic
├── sw.js                service worker (notifications on phones)
├── manifest.webmanifest
├── logo.svg             favicon and header logo
├── icon.svg             square app icon (source of the PNGs)
└── icons/               phone home-screen icons (180, 192, 512 px)
tests/                   end-to-end tests (Playwright)
├── package.json
├── playwright.config.js
├── server.js            tiny static server for src/
└── specs/               test files
```

## Running locally

Open `src/index.html` in a browser — that's enough for the timer itself.

Notifications through the service worker and "Keep screen on" need a secure context, so for the full feature set serve the folder from `localhost`:

```sh
cd src
python -m http.server 8000
# then open http://localhost:8000
```

(Any static server works, e.g. `npx serve src`.)

## Deploying

Upload the contents of `src/` to any static host that serves over `https://` (GitHub Pages, Netlify, Cloudflare Pages, …).

On GitHub Pages, either publish with a GitHub Actions workflow that uploads `src/`, or copy `src/` to a `docs/` folder and choose "Deploy from a branch → /docs", since branch deploys only support the repository root or `/docs`.

## On phones

- **Android**: works in the browser; "Add to Home screen" installs it as an app.
- **iPhone / iPad**: notifications only work after "Add to Home Screen" (iOS 16.4+). In a normal Safari tab you get the sound only. The iPhone silent switch mutes the sound.
- While the phone is locked or the app is in the background, browsers pause the page: the alert comes when you return, and the timer catches up. Exact alerts with the phone locked would need push messages from a server, which this project deliberately doesn't use.

## Tests

End-to-end tests use [Playwright](https://playwright.dev) with the installed **Microsoft Edge** (no browser download needed). Requires Node.js 18+.

```sh
cd tests
npm install
npm test             # run all tests headless
npm run test:headed  # watch them in a browser window
npm run report       # open the HTML report of the last run
```

Playwright starts `server.js` automatically, which serves `src/` on `http://127.0.0.1:4173`.

How they work:

- **Fake clock** — tests jump through 25-minute steps, 12-hour gaps and "phone was asleep" in milliseconds (`page.clock.runFor` / `fastForward`).
- **Mocks** (`specs/helpers.js`) record what the app does with things a headless browser can't do: notifications, sound, Screen Wake Lock and tab visibility.
- **Seeding** — `seed(page, { settings, state })` puts saved data in `localStorage` before the app loads.

| File | Covers |
|---|---|
| `timer.spec.js` | Start/Stop, countdown, title, Reset current, Reset session |
| `cycles.spec.js` | step transitions, long break, counters, dots, Skip, Auto-start |
| `settings.spec.js` | lengths, set size, validation, Defaults, switches, volume |
| `persistence.spec.js` | reload, reopening paused, last active time, catch-up, 12-hour reset |
| `alerts.spec.js` | notification permission, sounds and the sound picker, service worker |
| `duplicates.spec.js` | exactly one alert per step end; several tabs staying in sync |
| `wakelock.spec.js` | Keep screen on |
| `page.spec.js` | leave-page confirmation, colours, head metadata, icons, sizes |
| `layout.spec.js` | centring and control placement (desktop + phone viewport) |
| `touch.spec.js` | tapping on a phone: Start, sound unlock, Skip, Settings (phone only) |
| `sw-unit.spec.js` | `sw.js` handlers, run in Node |

## License

[MIT](LICENSE)
