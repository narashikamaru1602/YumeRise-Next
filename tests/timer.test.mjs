/**
 * Focus timer regressions (whole-project audit).
 *
 * The timer is a module singleton, so each test starts from a known state via
 * reset(). Node's mock timers drive both setInterval and Date, which is what
 * lets the wall-clock behaviour be tested without real waiting.
 *
 * Persistence (addSession) cannot run in Node — there is no IndexedDB — so
 * these tests assert the state-machine and timing contracts only; the write
 * path itself is exercised in the browser.
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as timer from '../src/features/focus/timer.js';

/** Enable mocked time for the duration of a test and always clean up. */
function withMockedTime(fn) {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    fn();
  } finally {
    timer.pause();
    timer.reset(25);
    mock.timers.reset();
  }
}

test('remainingFrom counts down to zero and never below', () => {
  assert.equal(timer.remainingFrom(5000, 1000), 4);
  assert.equal(timer.remainingFrom(1000, 1000), 0);
  assert.equal(timer.remainingFrom(900, 5000), 0, 'past the end clamps to 0');
});

test('a preset cannot discard a session that is running', () => {
  withMockedTime(() => {
    timer.reset(25);
    timer.start();
    assert.equal(timer.snapshot().running, true);

    timer.setDuration(50); // used to silently reset the countdown

    const snap = timer.snapshot();
    assert.equal(snap.running, true, 'still running');
    assert.equal(snap.durationMin, 25, 'duration untouched while running');
    assert.equal(snap.remainingSec, 25 * 60, 'elapsed time not discarded');

    // Contract refinement (editable-duration enhancement): a PAUSED session
    // still holds resumable elapsed time, so a length change is refused
    // there too — the old "presets work once paused" behaviour silently
    // threw that elapsed time away.
    timer.pause();
    assert.equal(timer.setDuration(50), false, 'refused while paused');
    assert.equal(timer.snapshot().durationMin, 25, 'paused session keeps its length');
    assert.equal(timer.snapshot().inProgress, true, 'paused mid-session counts as in progress');

    // Only an explicit reset ends the session; then the length may change.
    timer.reset();
    assert.equal(timer.setDuration(50), true, 'a change after an explicit reset succeeds');
    assert.equal(timer.snapshot().durationMin, 50);
  });
});

test('a backgrounded countdown catches up with the wall clock', () => {
  withMockedTime(() => {
    timer.reset(25);
    timer.start();
    const t0 = Date.now();

    // 60s of wall time pass while setInterval is throttled (hidden tab /
    // backgrounded WebView), then the late interval finally fires.
    mock.timers.setTime(t0 + 60_000);
    mock.timers.tick(1000);

    const remaining = timer.snapshot().remainingSec;
    // Wall-clock based: ~61s consumed. A per-tick decrement would show only
    // one second lost and the session would stretch in real time.
    assert.ok(
      remaining <= 25 * 60 - 59,
      `expected ~${25 * 60 - 61}s remaining, got ${remaining}`
    );
    assert.ok(remaining >= 25 * 60 - 62, `overshot: ${remaining}`);
  });
});

test('natural finish flips to finished, and endEarly after it records nothing', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    timer.reset(5);
    timer.start();

    // Jump past the end; the interval fires and finishes the countdown.
    mock.timers.setTime(Date.now() + 5 * 60_000 + 2_000);
    mock.timers.tick(1000);

    const snap = timer.snapshot();
    assert.equal(snap.finished, true, 'countdown finished');
    assert.equal(snap.running, false);
    assert.equal(snap.remainingSec, 0);

    // give complete() (which fails without IndexedDB, and is caught) a turn
    await new Promise((resolve) => { setImmediate(resolve); });

    // The old defect: "End session early" after natural finish stored a
    // SECOND session for the same run.
    const recorded = await timer.endEarly();
    assert.equal(recorded, 0, 'no duplicate record after a natural finish');
  } finally {
    timer.pause();
    timer.reset(25);
    mock.timers.reset();
  }
});

test('endEarly before finishing keeps state consistent for the next session', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    timer.reset(25);
    timer.start();
    mock.timers.setTime(Date.now() + 90_000); // 90s elapsed
    mock.timers.tick(1000);

    // The write path rejects in Node (no IndexedDB) and must propagate so the
    // view can report a real failure instead of a fake success.
    await assert.rejects(() => timer.endEarly(), 'persistence errors propagate');

    const snap = timer.snapshot();
    assert.equal(snap.running, false, 'timer stopped after endEarly attempt');
    assert.equal(snap.remainingSec, 25 * 60, 'reset for the next session');
    assert.equal(snap.finished, false);
  } finally {
    timer.pause();
    timer.reset(25);
    mock.timers.reset();
  }
});

test('a throwing subscriber cannot starve the other listeners', () => {
  timer.reset(25);
  const calls = [];
  const offBad = timer.subscribe(() => {
    calls.push('bad');
    throw new Error('listener exploded');
  });
  const offGood = timer.subscribe(() => calls.push('good'));

  calls.length = 0;
  timer.pause(); // any state change emits to every listener

  assert.deepEqual(calls, ['bad', 'good'], 'both ran; the failure was contained');
  offBad();
  offGood();
});
