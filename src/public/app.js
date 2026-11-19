(() => {
  'use strict';

  const STORAGE_KEY = 'pomodoro.v1';
  const AUTO_RESET_MS = 12 * 60 * 60 * 1000; // 12 hours
  const DEFAULT_SETTINGS = { pomodoro: 25, short: 5, long: 15, cyclesBeforeLong: 4, autoStart: false, keepAwake: true, volume: 40, sound: 'marimba' };
  const MODE_NAMES = { pomodoro: 'Pomodoro', short: 'Short break', long: 'Long break' };

  // ---------- State ----------
  let settings = { ...DEFAULT_SETTINGS };
  let state = {
    mode: 'pomodoro',     // 'pomodoro' | 'short' | 'long'
    remaining: 25 * 60,   // seconds left in the current step
    completed: 0,         // pomodoros completed in the current set
    total: 0,             // pomodoros completed in this session
    running: false,
    endAt: null,          // timestamp (ms) when the running step ends
    lastActive: Date.now()
  };
  let tickHandle = null;
  let endHandle = null;
  let reopenPending = false; // reopened with a running timer, deciding what to do

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const timerEl = $('timer');
  const cycleTextEl = $('cycleText');
  const dotsEl = $('dots');
  const totalEl = $('sessionTotal');
  const autoStartInput = $('autoStartInput');
  const keepAwakeInput = $('keepAwakeInput');
  const volumeInput = $('volumeInput');
  const volumeValue = $('volumeValue');
  const soundInput = $('soundInput');
  const startStopBtn = $('startStopBtn');
  const inputs = {
    pomodoro: $('pomodoroInput'),
    short: $('shortInput'),
    long: $('longInput'),
    cyclesBeforeLong: $('cyclesInput')
  };

  // ---------- Helpers ----------
  const durationOf = (mode) => settings[mode] * 60;

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function currentRemaining() {
    return state.running ? Math.max(0, (state.endAt - Date.now()) / 1000) : state.remaining;
  }

  // ---------- Persistence ----------
  function save(activeAt = Date.now()) {
    reopenPending = false; // any real change settles the reopen decision
    state.lastActive = activeAt;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, state }));
    } catch (e) { /* storage unavailable — keep working in memory */ }
  }

  function load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) { /* ignore corrupted data */ }
    if (!data) return;

    if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (!SOUNDS[settings.sound]) settings.sound = DEFAULT_SETTINGS.sound;
    if (data.state) state = { ...state, ...data.state };
  }

  // ---------- Core logic ----------
  function nextMode() {
    if (state.mode === 'pomodoro') {
      state.completed += 1;
      state.total += 1;
      return state.completed >= settings.cyclesBeforeLong ? 'long' : 'short';
    }
    if (state.mode === 'long') state.completed = 0; // a full set is finished
    return 'pomodoro';
  }

  function switchTo(mode) {
    state.mode = mode;
    state.remaining = durationOf(mode);
    state.running = false;
    state.endAt = null;
  }

  function start() {
    if (state.running) return;
    requestNotificationPermission();
    unlockAudio();
    if (state.remaining <= 0) state.remaining = durationOf(state.mode);
    state.running = true;
    state.endAt = Date.now() + state.remaining * 1000;
    startTicking();
    save();
    render();
  }

  function stop() {
    if (!state.running) return;
    state.remaining = currentRemaining();
    state.running = false;
    state.endAt = null;
    stopTicking();
    save();
    render();
  }

  function resetCurrent() {
    stopTicking();
    switchTo(state.mode);
    save();
    render();
  }

  function resetAll() {
    stopTicking();
    state.completed = 0;
    state.total = 0;
    switchTo('pomodoro');
    save();
    render();
  }

  // Move past the current step, which ended at `endedAt`, and replay the
  // schedule up to `now`: with auto-start on, each next step starts exactly
  // when the previous one ended, so time spent with the page paused or closed
  // doesn't shift the schedule. Any step may auto-start except a new set:
  // after a long break we always wait for Start.
  // Returns the last step that finished and when it ended.
  function advance(endedAt, now) {
    for (;;) {
      const finished = state.mode;
      switchTo(nextMode()); // stopped, full length
      if (!settings.autoStart || finished === 'long') return { finished, endedAt };
      const endAt = endedAt + durationOf(state.mode) * 1000;
      if (endAt > now) {
        state.running = true;
        state.endAt = endAt;
        return { finished, endedAt };
      }
      endedAt = endAt; // this step also finished while we weren't looking
    }
  }

  // from: when the current step ended (now, for Skip).
  // silent: no sound/notification.
  function finishStep({ from, silent = false }) {
    stopTicking();
    const { finished, endedAt } = advance(from, Date.now());
    if (!state.running && Date.now() - endedAt > AUTO_RESET_MS) {
      resetAll(); // the last step ended 12h+ ago: start a fresh session, no alert
      return;
    }
    if (!silent) {
      // Saved with the state so other tabs can announce it too (only one will).
      // `from` (when the step ended) identifies this step end in every tab.
      state.announcement = { id: from, finished, next: state.mode, autoStarted: state.running };
    }
    if (state.running) {
      startTicking();
      save();
    } else {
      save(endedAt); // "last stop" is when the last step actually ended
    }
    render();
    if (!silent) announce(state.announcement);
  }

  function announce(a) {
    alertOnce(a.id, () => {
      playSound();
      notify(a.finished, a.next, a.autoStarted);
    });
  }

  // ---------- Several tabs ----------
  // Every open tab runs the same timer, so every tab sees each step end.
  // Only one of them may play the sound / show the notification:
  //  - a Web Lock named after the step end lets one tab in at a time, and is
  //    held for a while so tabs arriving moments later are turned away;
  //  - a shared record of the last announced step end catches tabs that are
  //    later still (e.g. a frozen background tab waking up).
  // Tabs the user has clicked in go first: only they are allowed to play sound.
  const ALERT_KEY = 'pomodoro.lastAlert';
  const ALERT_LOCK_HOLD_MS = 30 * 1000;

  function claimAlert(id) {
    try {
      if (localStorage.getItem(ALERT_KEY) === String(id)) return false;
      localStorage.setItem(ALERT_KEY, String(id));
    } catch (e) { /* storage unavailable: just alert */ }
    return true;
  }

  function alertOnce(id, fire) {
    if (!navigator.locks) {
      if (claimAlert(id)) fire();
      return;
    }
    const tryAlert = () => {
      navigator.locks.request(`pomodoro-alert-${id}`, { ifAvailable: true }, (lock) => {
        if (!lock || !claimAlert(id)) return null;
        fire();
        return new Promise((resolve) => setTimeout(resolve, ALERT_LOCK_HOLD_MS));
      }).catch(() => {});
    };
    const activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (activated) tryAlert();
    else setTimeout(tryAlert, 1500); // let a tab that can play sound go first
  }

  // Another tab saved: adopt its state and settings (without saving back).
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    let data;
    try { data = JSON.parse(e.newValue); } catch (err) { return; }
    if (!data || !data.settings || !data.state) return;
    reopenPending = false; // another tab is alive and in charge: follow it

    const settingsChanged = JSON.stringify(data.settings) !== JSON.stringify(settings);
    const prevAnnouncement = state.announcement && state.announcement.id;
    const prevEndAt = state.running ? state.endAt : null;
    settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (!SOUNDS[settings.sound]) settings.sound = DEFAULT_SETTINGS.sound;
    state = { ...state, ...data.state };

    // Restart the countdown only if it was started, stopped or changed; the
    // running tab's routine saves (every ~5 s) leave it alone.
    if (!state.running) stopTicking();
    else if (state.endAt !== prevEndAt) startTicking();
    if (settingsChanged) fillSettingsForm(); // don't clobber a field being typed in
    render();

    // Another tab finished a step first. This tab may be the one allowed to
    // play sound (the user clicked here), so it competes for the alert too.
    if (state.announcement && state.announcement.id !== prevAnnouncement) {
      announce(state.announcement);
    }
  });

  function tick() {
    if (!state.running) return;
    if (currentRemaining() <= 0) {
      finishStep({ from: state.endAt });
      return;
    }
    renderTime();
    // keep "last active" fresh without hammering storage every frame
    if (Date.now() - state.lastActive > 5000) save();
  }

  // The interval updates the display. In a background tab Chrome/Edge may slow
  // repeating timers to once a minute, so a one-off timeout is also set for
  // the exact end of the step: one-off timers are slowed far less (~1s), so
  // the sound and notification stay on time.
  function startTicking() {
    stopTicking();
    tickHandle = setInterval(tick, 250);
    if (state.running) {
      endHandle = setTimeout(tick, Math.max(0, state.endAt - Date.now()) + 50);
    }
  }

  function stopTicking() {
    if (tickHandle) clearInterval(tickHandle);
    if (endHandle) clearTimeout(endHandle);
    tickHandle = null;
    endHandle = null;
  }

  function autoResetIfStale() {
    if (!state.running && Date.now() - state.lastActive > AUTO_RESET_MS) {
      resetAll();
      return true;
    }
    return false;
  }

  // ---------- Notifications & sound ----------
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function notify(finished, next, autoStarted) {
    const title = `${MODE_NAMES[finished]} finished!`;
    let body;
    if (autoStarted) body = `${MODE_NAMES[next]} started.`;
    else if (finished === 'long' && settings.autoStart) {
      // Auto-start never starts a new set: say so, or the user may wait for it.
      body = 'Set complete. Press Start to begin the next set.';
    } else if (next === 'pomodoro') body = 'Break is over — time to focus.';
    else body = `Time for a ${MODE_NAMES[next].toLowerCase()}.`;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // renotify: with the same tag, a new notification would otherwise
    // silently replace the previous one instead of alerting again.
    const options = { body, tag: 'pomodoro', renotify: true, icon: 'icons/icon-192.png' };
    // Phones only allow notifications through the service worker; use it
    // whenever it's running so taps behave the same everywhere.
    if (swRegistration && swRegistration.active) {
      swRegistration.showNotification(title, options).catch(() => {});
      return;
    }
    try {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { /* no service worker and the constructor isn't allowed */ }
  }

  // Service workers need https:// or localhost; on a local file this simply
  // fails and notifications fall back to the constructor above.
  let swRegistration = null;
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => { swRegistration = reg; })
      .catch(() => {});
  }

  let audioCtx = null;
  function unlockAudio() {
    // Audio must be created/resumed from a user gesture (the Start click).
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  // Browsers only allow sound after the user has interacted with the page.
  // Any click, tap or key press (not just Start) prepares it — e.g. after a
  // reload while the timer is running. Listens until audio is running.
  const UNLOCK_EVENTS = ['pointerup', 'touchend', 'keydown'];
  function unlockOnInteraction() {
    unlockAudio();
    if (!audioCtx) return;
    Promise.resolve(audioCtx.state === 'running' || audioCtx.resume()).then(() => {
      if (audioCtx.state === 'running') {
        UNLOCK_EVENTS.forEach((t) => document.removeEventListener(t, unlockOnInteraction, true));
      }
    }).catch(() => {});
  }
  UNLOCK_EVENTS.forEach((t) => document.addEventListener(t, unlockOnInteraction, true));

  // One note: an oscillator with a fast attack and an exponential fade.
  function tone(out, { f, type = 'sine', t, peak, attack = 0.01, dur, glideTo }) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + attack + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Bell: a fundamental plus inharmonic overtones that die away faster.
  function bell(out, f, t, peak, dur) {
    [[1, 1], [2, 0.55], [3, 0.35], [4.2, 0.22], [5.4, 0.16], [6.8, 0.1]].forEach(([r, a], i) => {
      tone(out, { f: f * r, t, peak: (peak * a) / 2.4, attack: 0.003, dur: dur / (1 + i * 0.6) });
    });
  }

  // All sounds are generated, no audio files. v = volume (0..1].
  const SOUNDS = {
    marimba: {
      name: 'Marimba',
      play(out, t, v) {
        [523.3, 659.3, 784, 1046.5].forEach((f, i) => {
          const s = t + i * 0.13;
          tone(out, { f, t: s, peak: v * 0.8, attack: 0.004, dur: 0.6 });
          tone(out, { f: f * 3.93, t: s, peak: v * 0.15, attack: 0.002, dur: 0.12 });
        });
      }
    },
    beep: {
      name: 'Triple beep',
      play(out, t, v) {
        [0, 0.3, 0.6].forEach((o, i) =>
          tone(out, { f: i === 2 ? 1046 : 880, t: t + o, peak: v, attack: 0.02, dur: 0.25 }));
      }
    },
    dingdong: {
      name: 'Ding-dong',
      play(out, t, v) {
        bell(out, 659.3, t, v, 1.6);
        bell(out, 523.3, t + 0.45, v, 1.9);
      }
    },
    bowl: {
      name: 'Singing bowl',
      play(out, t, v) {
        [[196, 1, 4.2], [197.4, 0.7, 4.0], [531.2, 0.35, 2.6], [1009, 0.15, 1.6]].forEach(([f, a, d]) =>
          tone(out, { f, t, peak: v * a * 0.6, attack: 0.02, dur: d }));
      }
    },
    kitchen: {
      name: 'Kitchen timer',
      play(out, t, v) {
        for (let i = 0; i < 16; i++) {
          const s = t + i * 0.065;
          tone(out, { f: 2093, t: s, peak: v * 0.45, attack: 0.002, dur: 0.12 });
          tone(out, { f: 2093 * 2.76, t: s, peak: v * 0.12, attack: 0.002, dur: 0.05 });
        }
      }
    },
    alarm: {
      name: 'Digital alarm',
      play(out, t, v) {
        [0, 0.14, 0.5, 0.64, 1.0, 1.14].forEach((o) =>
          tone(out, { f: 1975, type: 'square', t: t + o, peak: v * 0.22, attack: 0.003, dur: 0.09 }));
      }
    },
    rise: {
      name: 'Soft rise',
      play(out, t, v) {
        tone(out, { f: 740, glideTo: 784, t, peak: v * 0.8, attack: 0.05, dur: 0.7 });
        tone(out, { f: 988, glideTo: 1046.5, t: t + 0.22, peak: v * 0.8, attack: 0.05, dur: 1.0 });
      }
    },
    sparkle: {
      name: 'Sparkle',
      play(out, t, v) {
        [1318.5, 1568, 1760, 2093, 2637].forEach((f, i) =>
          tone(out, { f, t: t + i * 0.075, peak: v * 0.5, attack: 0.003, dur: 0.9 - i * 0.08 }));
      }
    }
  };

  function playSound() {
    const peak = settings.volume / 100; // 1 = the loudest a page can play
    if (peak <= 0) return;
    unlockAudio();
    if (!audioCtx) return;
    const sound = SOUNDS[settings.sound] || SOUNDS[DEFAULT_SETTINGS.sound];
    sound.play(audioCtx.destination, audioCtx.currentTime + 0.02, peak);
  }

  // ---------- Keep screen on (Screen Wake Lock API) ----------
  // Holds the lock only while the timer runs, the switch is on and the page is
  // visible. The browser drops the lock itself when the page is hidden, so this
  // is re-checked on every render (including when the tab becomes visible).
  const wakeLockSupported = 'wakeLock' in navigator;
  let wakeLock = null;
  let wakeLockPending = false;
  // After a refusal (e.g. battery saver) don't ask again until the lock is no
  // longer wanted (timer stopped, switch off, tab hidden); retrying right away
  // would loop forever and freeze the page.
  let wakeLockRefused = false;

  async function updateWakeLock() {
    if (!wakeLockSupported) return;
    const want = state.running && settings.keepAwake && document.visibilityState === 'visible';
    if (!want) wakeLockRefused = false;
    if (want && !wakeLock && !wakeLockPending && !wakeLockRefused) {
      wakeLockPending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
        wakeLock = lock;
      } catch (e) {
        wakeLockRefused = true; // the timer still works, just without the lock
      }
      wakeLockPending = false;
      updateWakeLock(); // state may have changed while waiting
    } else if (!want && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      lock.release().catch(() => {});
    }
  }

  // ---------- Rendering ----------
  function renderTime() {
    const text = formatTime(currentRemaining());
    timerEl.textContent = text;
    document.title = `${text} · ${MODE_NAMES[state.mode]}`;
  }

  function render() {
    document.body.className = `mode-${state.mode}`;
    // keep the phone's browser bar in the current step's colour
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    if (accent) document.querySelector('meta[name="theme-color"]').setAttribute('content', accent);
    document.querySelectorAll('.mode-label').forEach((el) => {
      el.classList.toggle('active', el.dataset.mode === state.mode);
    });

    startStopBtn.textContent = state.running ? 'Stop' : 'Start';

    const total = settings.cyclesBeforeLong;
    const done = Math.min(state.completed, total);
    // During a pomodoro: which one is running. During a break: how many are done.
    cycleTextEl.textContent = state.mode === 'pomodoro'
      ? `${done + 1} of ${total}`
      : `${done} of ${total} done`;

    dotsEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      if (i < done) dot.classList.add('done');
      if (i === done && state.mode === 'pomodoro') dot.classList.add('current');
      dotsEl.appendChild(dot);
    }

    totalEl.textContent = `Pomodoros this session: ${state.total}`;
    updateWakeLock();

    renderTime();
  }

  function fillSettingsForm() {
    Object.keys(inputs).forEach((k) => { inputs[k].value = settings[k]; });
    autoStartInput.checked = !!settings.autoStart;
    keepAwakeInput.checked = wakeLockSupported && !!settings.keepAwake;
    soundInput.value = settings.sound;
    volumeInput.value = settings.volume;
    volumeValue.textContent = `${settings.volume}%`;
  }

  // ---------- Settings ----------
  function applySettings(newSettings) {
    const oldDuration = durationOf(state.mode);
    const untouched = !state.running && state.remaining === oldDuration;
    settings = newSettings;
    // Update the current step only if it hasn't been started yet.
    if (untouched) state.remaining = durationOf(state.mode);
    save();
    fillSettingsForm();
    render();
  }

  $('settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    // The browser only fires submit when every field passes its min/max/step/
    // required attributes, so the values are already whole numbers in range.
    const read = (k) => Number(inputs[k].value);
    applySettings({
      pomodoro: read('pomodoro'),
      short: read('short'),
      long: read('long'),
      cyclesBeforeLong: read('cyclesBeforeLong'),
      // switches, sound and volume apply instantly on change; Save keeps them
      autoStart: settings.autoStart,
      keepAwake: settings.keepAwake,
      volume: settings.volume,
      sound: settings.sound
    });
  });

  $('defaultsBtn').addEventListener('click', () => applySettings({ ...DEFAULT_SETTINGS }));

  // The switch applies immediately, no Save needed.
  autoStartInput.addEventListener('change', () => {
    settings.autoStart = autoStartInput.checked;
    save();
  });

  keepAwakeInput.addEventListener('change', () => {
    settings.keepAwake = keepAwakeInput.checked;
    save();
    updateWakeLock();
  });

  // Sound list is built from SOUNDS; picking one applies instantly and plays it.
  Object.entries(SOUNDS).forEach(([id, s]) => soundInput.add(new Option(s.name, id)));
  soundInput.addEventListener('change', () => {
    settings.sound = soundInput.value;
    save();
    playSound();
  });
  $('soundPreviewBtn').addEventListener('click', playSound);

  // Volume applies instantly while dragging; letting go plays a test sound.
  volumeInput.addEventListener('input', () => {
    settings.volume = Number(volumeInput.value);
    volumeValue.textContent = `${settings.volume}%`;
    save();
  });
  volumeInput.addEventListener('change', playSound);

  if (!wakeLockSupported) {
    keepAwakeInput.disabled = true;
    keepAwakeInput.closest('label').title = 'Not supported in this browser';
    keepAwakeInput.closest('label').classList.add('unsupported');
  }

  // ---------- Events ----------
  startStopBtn.addEventListener('click', () => (state.running ? stop() : start()));
  // Skip moves to the next step as if the current one had finished
  // (a skipped pomodoro counts toward the set), but without sound/notification.
  $('skipBtn').addEventListener('click', () => finishStep({ from: Date.now(), silent: true }));
  $('resetCurrentBtn').addEventListener('click', resetCurrent);
  $('resetAllBtn').addEventListener('click', () => {
    if (confirm('Reset the session? This clears the current set and the session total, and starts over from the first pomodoro.')) resetAll();
  });

  // If the tab was left open and idle for 12h+, reset when the user comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!autoResetIfStale()) render();
    } else {
      updateWakeLock(); // not wanted while hidden: clears a previous refusal
    }
  });

  // Catch the 12h idle reset even if the tab stays visible the whole time.
  // Read-only unless the reset fires; does nothing while the timer runs.
  setInterval(autoResetIfStale, 60 * 1000);

  // Only a running timer needs a final save; a stopped one is already saved
  // and must keep its original "last stop" time for the 12h auto-reset.
  // While running, also ask the browser to confirm leaving the page.
  window.addEventListener('beforeunload', (e) => {
    if (!state.running) return;
    save();
    e.preventDefault();
    e.returnValue = ''; // required by some browsers to show the dialog
  });
  // Phones often skip beforeunload; pagehide is the reliable "page is going away".
  window.addEventListener('pagehide', () => { if (state.running) save(); });

  // ---------- Reopening ----------
  // When the last tab closes, the timer freezes at that moment. Opening the
  // site again (or reloading) shows the time that was left and waits for
  // Start — so the user's first action is a tap/click, which also unlocks
  // sound. If another tab is still open and running, follow it instead.
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pomodoro') : null;
  let reopenClosedAt = 0;

  if (channel) {
    channel.onmessage = (e) => {
      if (e.data === 'anyone-here?' && !reopenPending) {
        channel.postMessage('here'); // a live tab (not one that is reopening itself)
      } else if (e.data === 'here' && reopenPending) {
        // Another tab is running the timer: follow it.
        reopenPending = false;
        load();
        if (state.running) startTicking();
        else stopTicking();
        fillSettingsForm();
        render();
      }
    };
  }

  // Freeze the timer at the moment the page was closed (the last save).
  // Steps that had already ended before closing are moved past silently.
  function pauseAtClose() {
    const closedAt = Math.min(state.lastActive || Date.now(), Date.now());
    stopTicking();
    if (state.endAt <= closedAt) advance(state.endAt, closedAt);
    if (state.running) {
      state.remaining = Math.max(0, (state.endAt - closedAt) / 1000);
      state.running = false;
      state.endAt = null;
    }
    return closedAt;
  }

  function commitReopen() {
    save(reopenClosedAt); // "last stop" = when it was closed (12h rule)
    if (!autoResetIfStale()) render();
  }

  function reopen() {
    reopenClosedAt = pauseAtClose(); // shown paused right away (not saved yet)
    if (!channel) return commitReopen();
    reopenPending = true;
    channel.postMessage('anyone-here?');
    setTimeout(() => { if (reopenPending) commitReopen(); }, 250);
  }

  // Back/forward cache: the page was frozen, not closed — treat it the same.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && state.running) {
      reopen();
      fillSettingsForm();
      render();
    }
  });

  // ---------- Init ----------
  registerServiceWorker();
  load();
  if (state.running) reopen();
  else autoResetIfStale();
  fillSettingsForm();
  render();
})();
