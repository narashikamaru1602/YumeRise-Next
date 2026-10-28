/**
 * Focus timer feature.
 *
 * A small, framework-free countdown that survives navigation (it lives in a
 * module singleton, not inside a view) and records a session when it finishes.
 * Durations are validated; completion writes through the repository so the
 * session is real stored data.
 */

import { addSession } from '../../data/repositories.js';
import { formatClock } from '../../core/utils.js';

const listeners = new Set();

/* Bumped every time a session is actually persisted; views compare it against
   the last value they saw so a finished session re-renders its lists once the
   record really exists (not while the write is still in flight). */
let recordedSeq = 0;

/* Configurable session length: 1–180 minutes. The chosen length is persisted
   as a local preference ('yrn.focusMin') the same way theme/accent are kept
   in core/theme.js — a preference, never a record; nothing in storage changes
   when the user only picks a different length. */
export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 180;
const DEFAULT_DURATION_MIN = 25;
const DURATION_KEY = 'yrn.focusMin';

/** Read the stored preference; anything invalid falls back to the default. */
function readStoredDuration() {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_DURATION_MIN;
    const raw = localStorage.getItem(DURATION_KEY);
    // Absent (null) is not "0 minutes": Number(null) is 0, which would
    // wrongly clamp up to 1 — no stored value means "use the default".
    if (raw == null || raw === '') return DEFAULT_DURATION_MIN;
    return clampDuration(raw);
  } catch (err) {
    // Storage blocked (private mode, embedded WebView): default is fine.
    return DEFAULT_DURATION_MIN;
  }
}

/** Best-effort write; a failed preference save must never break the timer. */
function persistDuration(durationMin) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DURATION_KEY, String(durationMin));
  } catch (err) {
    /* preference simply won't survive a reload */
  }
}

const initialDurationMin = readStoredDuration();

const state = {
  durationMin: initialDurationMin,
  remainingSec: initialDurationMin * 60,
  running: false,
  finished: false,
  intervalId: null,
  startedAt: null,
  // Wall-clock end time while running; null when paused/reset. This keeps the
  // countdown honest when setInterval is throttled (background tab, WebView).
  endsAtMs: null,
};

function emit() {
  for (const fn of listeners) {
    try { fn(snapshot()); } catch (err) { console.error('timer listener failed', err); }
  }
}

export function snapshot() {
  return {
    durationMin: state.durationMin,
    remainingSec: state.remainingSec,
    running: state.running,
    finished: state.finished,
    // A session the user is still in: running, or started-and-paused with
    // elapsed time. Its countdown must never be changed or discarded.
    inProgress: state.running || (state.startedAt != null && !state.finished),
    display: formatClock(state.remainingSec),
    recordedSeq,
    // 0..100 elapsed, for the ring.
    progress: state.durationMin > 0
      ? Math.min(100, ((state.durationMin * 60 - state.remainingSec) / (state.durationMin * 60)) * 100)
      : 0,
  };
}

export function subscribe(fn) {
  listeners.add(fn);
  // Same guard as emit(): a failing subscriber must not break subscription
  // or starve the other listeners.
  try { fn(snapshot()); } catch (err) { console.error('timer listener failed', err); }
  return () => listeners.delete(fn);
}

function clearTick() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

/**
 * Seconds left at `nowMs` for a countdown ending at `endsAtMs`. Never negative.
 * Pure so the wall-clock behaviour is unit-testable without real timers.
 */
export function remainingFrom(endsAtMs, nowMs) {
  return Math.max(0, Math.round((endsAtMs - nowMs) / 1000));
}

function tick() {
  if (!state.running) return;
  if (state.endsAtMs != null) {
    // Recompute from the wall clock: throttled intervals fire late but the
    // session still ends at the right real-world time (no stretched sessions).
    state.remainingSec = remainingFrom(state.endsAtMs, Date.now());
  } else {
    state.remainingSec -= 1;
  }
  if (state.remainingSec <= 0) {
    state.remainingSec = 0;
    state.running = false;
    state.finished = true;
    state.endsAtMs = null;
    clearTick();
    // Views are notified ONCE, after the save attempt settles: emitting before
    // the save made them render the session log before the record existed, so
    // the just-finished session never appeared until the next interaction.
    complete().finally(emit);
    return;
  }
  emit();
}

async function complete() {
  try {
    await addSession({
      minutes: state.durationMin,
      startedAt: state.startedAt || new Date(Date.now() - state.durationMin * 60000).toISOString(),
    });
    recordedSeq += 1;
  } catch (err) {
    console.error('failed to record focus session', err);
  }
}

/* A hidden tab / backgrounded WebView throttles setInterval; resync from the
   wall clock as soon as the app is visible again. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.running) tick();
  });
}

export function start() {
  if (state.running) return;
  if (state.remainingSec <= 0) reset(state.durationMin);
  state.running = true;
  state.finished = false;
  state.startedAt = state.startedAt || new Date().toISOString();
  state.endsAtMs = Date.now() + state.remainingSec * 1000;
  clearTick();
  state.intervalId = setInterval(tick, 1000);
  emit();
}

export function pause() {
  state.running = false;
  state.endsAtMs = null;
  clearTick();
  emit();
}

export function reset(durationMin = state.durationMin) {
  clearTick();
  state.durationMin = clampDuration(durationMin);
  state.remainingSec = state.durationMin * 60;
  state.running = false;
  state.finished = false;
  state.startedAt = null;
  state.endsAtMs = null;
  emit();
}

/**
 * Choose a new session length (1–180 minutes). Returns true when applied,
 * false when refused.
 *
 * Refused — and never silently applied — while a session is in progress
 * (running, or paused with elapsed time): changing the length there would
 * discard the countdown and the time already focused. The user finishes or
 * resets first, then picks a new length.
 */
export function setDuration(durationMin) {
  if (state.running || (state.startedAt != null && !state.finished)) return false;
  reset(durationMin);
  persistDuration(state.durationMin);
  return true;
}

/** Finish early and record whatever minutes actually elapsed. */
export async function endEarly() {
  // The countdown already finished on its own: complete() recorded that
  // session. Ending "early" now would store it a second time.
  if (state.finished) return 0;
  const elapsedMin = Math.round((state.durationMin * 60 - state.remainingSec) / 60);
  clearTick();
  state.running = false;
  state.endsAtMs = null;
  state.remainingSec = state.durationMin * 60;
  state.startedAt = null;
  emit();
  if (elapsedMin >= 1) {
    // If this write fails the error propagates to the caller, which reports
    // it — there is never a "recorded" toast for a session that was not saved.
    await addSession({ minutes: elapsedMin, startedAt: new Date(Date.now() - elapsedMin * 60000).toISOString() });
    recordedSeq += 1;
    emit(); // other mounted views (e.g. Home stats) pick up the new record
    return elapsedMin;
  }
  return 0;
}

export const PRESETS = [15, 25, 50];

/**
 * Coerce any value to a whole minute count inside 1–180.
 * Non-numeric input falls back to the default length; 0 clamps up to 1
 * (the repository stores whole minutes ≥ 1 anyway).
 */
function clampDuration(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_DURATION_MIN;
  return Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, n));
}
