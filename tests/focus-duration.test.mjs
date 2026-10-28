/**
 * Editable focus duration regressions (Enhancement 1).
 *
 * localStorage is stubbed BEFORE the timer module is first imported, and the
 * file runs as its own process (node --test isolates files), so the storage
 * the timer reads at load time is deterministic. `freshTimer()` then imports
 * a cache-busted copy of the module so each test starts from a clean
 * singleton — the timer holds real module state, so this is the only way to
 * re-run "page load" with a different stored preference.
 *
 * The write path (addSession) cannot run in Node — no IndexedDB — so these
 * tests cover validation, preference persistence, state-machine guards and
 * timing only; recording itself is exercised in the browser.
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/* ---- deterministic storage stub (must exist before the module loads) ---- */
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};

let seq = 0;
/** Fresh timer singleton reading the given stored preference. */
async function freshTimer(stored = {}) {
  store.clear();
  for (const [key, value] of Object.entries(stored)) store.set(key, value);
  seq += 1;
  return import(`../src/features/focus/timer.js?v=${seq}`);
}

/* ---------------- preference loading ---------------- */

test('no stored preference keeps the 25-minute default', async () => {
  const timer = await freshTimer();
  const snap = timer.snapshot();
  assert.equal(snap.durationMin, 25);
  assert.equal(snap.remainingSec, 25 * 60);
  assert.equal(store.has('yrn.focusMin'), false, 'reading does not write');
});

test('a stored preference is applied on load', async () => {
  const timer = await freshTimer({ 'yrn.focusMin': '45' });
  assert.equal(timer.snapshot().durationMin, 45);
  assert.equal(timer.snapshot().remainingSec, 45 * 60);
});

test('an absent preference is 25 — Number(null) must not clamp to a 1-minute session', async () => {
  const timer = await freshTimer({ 'yrn.focusMin': null });
  assert.equal(timer.snapshot().durationMin, 25);
});

test('an invalid stored preference falls back to the default', async () => {
  const timer = await freshTimer({ 'yrn.focusMin': 'abc' });
  assert.equal(timer.snapshot().durationMin, 25);
});

test('out-of-range stored preferences are clamped into 1–180', async () => {
  const big = await freshTimer({ 'yrn.focusMin': '9999' });
  assert.equal(big.snapshot().durationMin, 180);
  const zero = await freshTimer({ 'yrn.focusMin': '0' });
  assert.equal(zero.snapshot().durationMin, 1);
});

/* ---------------- validation ---------------- */

test('setDuration clamps typed values into the supported range', async () => {
  const timer = await freshTimer();
  assert.equal(timer.setDuration(0), true);
  assert.equal(timer.snapshot().durationMin, 1, '0 clamps up to the 1-minute floor');
  assert.equal(timer.setDuration(500), true);
  assert.equal(timer.snapshot().durationMin, 180, 'ceiling is 180 minutes');
  assert.equal(timer.setDuration(40.6), true);
  assert.equal(timer.snapshot().durationMin, 41, 'fractional input rounds to whole minutes');
  assert.equal(timer.setDuration('180'), true);
  assert.equal(timer.snapshot().durationMin, 180, 'string numbers from an input element are accepted');
  assert.equal(timer.setDuration('abc'), true);
  assert.equal(timer.snapshot().durationMin, 25, 'non-numeric input falls back to the default');
});

test('a successful change persists the preference for the next page load', async () => {
  const timer = await freshTimer();
  assert.equal(timer.setDuration(40), true);
  assert.equal(store.get('yrn.focusMin'), '40', 'stored like theme/accent, under yrn.*');
  const reloaded = await import(`../src/features/focus/timer.js?v=reload${seq += 1}`);
  assert.equal(reloaded.snapshot().durationMin, 40, 'a "reload" picks the preference up');
});

/* ---------------- mid-session guards ---------------- */

test('a running session refuses duration changes and keeps its countdown', async (t) => {
  const timer = await freshTimer();
  try {
    timer.start();
    assert.equal(timer.snapshot().inProgress, true);
    assert.equal(timer.setDuration(50), false, 'refusal is reported, not silent');
    const snap = timer.snapshot();
    assert.equal(snap.durationMin, 25, 'duration untouched');
    assert.ok(snap.remainingSec > 0 && snap.remainingSec <= 25 * 60, 'countdown intact — elapsed time not discarded');
  } finally {
    timer.pause();
    timer.reset(25);
  }
});

test('a paused session with elapsed time also refuses duration changes', async () => {
  const timer = await freshTimer();
  timer.reset(25);
  timer.start();
  timer.pause();
  assert.equal(timer.snapshot().inProgress, true, 'paused mid-session is still in progress');
  assert.equal(timer.setDuration(50), false, 'no silent reset of elapsed time');
  assert.equal(timer.snapshot().durationMin, 25);

  // An explicit reset ends the session — only then may the length change.
  timer.reset();
  assert.equal(timer.snapshot().inProgress, false);
  assert.equal(timer.setDuration(50), true);
  assert.equal(timer.snapshot().durationMin, 50);
});

test('a custom length drives the countdown to a natural finish', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const timer = await freshTimer();
    assert.equal(timer.setDuration(1), true, 'the 1-minute floor is a valid session');
    timer.start();
    mock.timers.setTime(Date.now() + 61_000);
    mock.timers.tick(1000);

    const snap = timer.snapshot();
    assert.equal(snap.finished, true, 'finished on schedule');
    assert.equal(snap.remainingSec, 0);
    assert.equal(snap.inProgress, false, 'a finished session is no longer in progress');
    await new Promise((resolve) => { setImmediate(resolve); }); // complete() settles

    assert.equal(timer.snapshot().durationMin, 1, 'the chosen length survives the finish');
    assert.equal(timer.setDuration(30), true, 'a new length is accepted for the next session');
  } finally {
    mock.timers.reset();
  }
});
