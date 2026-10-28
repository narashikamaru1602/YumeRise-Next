import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sum, pctOf, pctChange, clamp, goalProgress,
  localDayOf, localMinutesOf, spanMinutes,
  dayShort, resolveRange, rangeLabel, dayList, makeBuckets, granularityFor,
  buildAnalytics, RANGES,
  activeDaysIn, longestRun, longestGap,
} from '../src/data/analytics.js';
import { dayIndex, startOfWeek, addDaysLabel, timeToMinutes, formatDuration } from '../src/core/utils.js';

/* ============================================================
   Deterministic fixture. All timestamps are timezone-naive so
   Node parses them as local time — day/hour bucketing is stable
   regardless of the machine timezone.
   ============================================================ */

const TODAY = '2026-10-18'; // a Sunday: the week under test is Mon 12 – Sun 18 Oct

const task = (id, date, priority, status, extra = {}) => ({
  id, date, priority, status, createdAt: `${date}T12:00:00.000`, ...extra,
});

function fixture() {
  return {
    tasks: [
      // current week (12–18 Oct): 6 done + 2 open on the 15th/16th
      task('h1', '2026-10-15', 'High', 'done'),
      task('h2', '2026-10-15', 'High', 'done', { startTime: '15:00', endTime: '16:00' }),
      task('h3', '2026-10-15', 'High', 'done'),
      task('m1', '2026-10-15', 'Medium', 'done', { startTime: '10:00', endTime: '11:00' }),
      task('m2', '2026-10-15', 'Medium', 'done'),
      task('l1', '2026-10-15', 'Low', 'done'),
      task('m3', '2026-10-16', 'Medium', 'todo'),
      task('l2', '2026-10-16', 'Low', 'todo'),
      // previous week (5–11 Oct): 2 done + 1 open
      task('h0', '2026-10-07', 'High', 'done'),
      task('m0', '2026-10-07', 'Medium', 'done'),
      task('l0', '2026-10-08', 'Low', 'todo'),
      // earlier history for the monthly trend
      task('s1', '2026-09-10', 'High', 'done'),
    ],
    sessions: [
      { id: 'ses1', minutes: 90, startedAt: '2026-10-15T14:30:00' },
      { id: 'ses2', minutes: 45, startedAt: '2026-10-16T09:00:00' },
      { id: 'ses3', minutes: 60, startedAt: '2026-10-07T20:00:00' }, // previous week
      { id: 'ses4', minutes: 30, startedAt: '2026-09-10T08:00:00' }, // September
      // invalid records: must be ignored without crashing
      { id: 'bad1', minutes: 40, startedAt: 'not-a-date' },
    ],
    goals: [
      { id: 'g1', title: 'Run 10 km', kind: 'active', progress: 40, target: 10, current: 4, unit: 'km', done: false },
      { id: 'g2', title: 'Inbox zero', kind: 'active', progress: 100, target: 0, current: 0, unit: '', done: true },
    ],
    blocks: [
      { id: 'b1', date: '2026-10-15', startTime: '14:00', endTime: '16:00', linkedTaskId: 'h1' }, // 120 planned
      { id: 'b4', date: '2026-10-15', startTime: '10:00', endTime: '11:00', linkedTaskId: 'm1' }, // 60 planned
      { id: 'b2', date: '2026-10-16', startTime: '09:00', endTime: '10:00' }, // 60 planned, unlinked
      { id: 'b3', date: '2026-10-07', startTime: '09:00', endTime: '11:00', linkedTaskId: 'h0' }, // previous week
      // invalid times: contributes zero, no crash
      { id: 'badblock', date: '2026-10-14', startTime: '25:00', endTime: '26:00' },
    ],
  };
}

/* ---------------- math helpers ---------------- */

test('sum / clamp basics', () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([]), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(-2, 0, 10), 0);
});

test('pctOf and pctChange return null instead of fabricating a rate', () => {
  assert.equal(pctOf(3, 4), 75);
  assert.equal(pctOf(0, 4), 0);
  assert.equal(pctOf(1, 0), null); // no denominator → no percentage
  assert.equal(pctChange(12, 10), 20);
  assert.equal(pctChange(8, 10), -20);
  assert.equal(pctChange(5, 0), null); // no baseline → no change
});

test('localDayOf / localMinutesOf use the local timezone', () => {
  assert.equal(localDayOf('2026-10-15T14:30:00'), '2026-10-15');
  assert.equal(localMinutesOf('2026-10-15T14:30:00'), 14 * 60 + 30);
  assert.equal(localDayOf('not-a-date'), null);
  assert.equal(localMinutesOf(''), null);
});

test('spanMinutes validates both ends', () => {
  assert.equal(spanMinutes('09:00', '10:30'), 90);
  assert.equal(spanMinutes('10:00', '09:00'), null); // negative
  assert.equal(spanMinutes('bad', '10:00'), null);
  assert.equal(spanMinutes('09:00', '09:00'), null); // zero-length
});

test('dayShort renders a compact day label', () => {
  assert.equal(dayShort('2026-10-15'), new Date(2026, 9, 15).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
});

/* ---------------- ranges ---------------- */

test('RANGES offers the four approved windows', () => {
  assert.deepEqual(RANGES.map((r) => r.key), ['week', 'month', '90', 'all']);
});

test('resolveRange week: Monday-anchored with a full previous week', () => {
  const r = resolveRange('week', 0, TODAY);
  assert.equal(r.start, '2026-10-12'); // Monday of the week containing Sunday 18 Oct
  assert.equal(r.end, '2026-10-18');
  assert.equal(r.prevStart, '2026-10-05');
  assert.equal(r.prevEnd, '2026-10-11');
  assert.equal(r.granularity, 'day');
  assert.equal(r.isCurrent, true);
  assert.ok(r.label.length > 0);
  assert.equal(startOfWeek(TODAY), '2026-10-12');
});

test('resolveRange week caps the current period at today (mid-week)', () => {
  const r = resolveRange('week', 0, '2026-10-15'); // Thursday
  assert.equal(r.start, '2026-10-12');
  assert.equal(r.end, '2026-10-15'); // capped
  assert.equal(r.fullEnd, '2026-10-18');
  const back = resolveRange('week', 1, '2026-10-15');
  assert.equal(back.start, '2026-10-05');
  assert.equal(back.end, '2026-10-11');
});

test('resolveRange month walks back by calendar month', () => {
  const r = resolveRange('month', 0, TODAY);
  assert.equal(r.start, '2026-10-01');
  assert.equal(r.end, '2026-10-18'); // capped at today
  assert.equal(r.prevStart, '2026-09-01');
  assert.equal(r.prevEnd, '2026-09-30');
  const prev = resolveRange('month', 1, TODAY);
  assert.equal(prev.start, '2026-09-01');
  assert.equal(prev.end, '2026-09-30');
});

test('resolveRange 90 days uses a week granularity and a 90-day previous window', () => {
  const r = resolveRange('90', 0, TODAY);
  assert.equal(r.end, TODAY);
  assert.equal(r.start, addDaysLabel(TODAY, -89));
  assert.equal(r.prevEnd, addDaysLabel(r.start, -1));
  assert.equal(r.prevStart, addDaysLabel(r.start, -90));
  assert.equal(r.granularity, 'week');
});

test('resolveRange all: bounded by dataStart, no previous window', () => {
  const r = resolveRange('all', 0, TODAY, '2026-05-01');
  assert.equal(r.start, '2026-05-01');
  assert.equal(r.end, TODAY);
  assert.equal(r.prevStart, null);
  assert.equal(r.allTime, true);
  // ancient dataStart is floored at one year back
  const floored = resolveRange('all', 0, TODAY, '2019-01-01');
  assert.equal(floored.start, addDaysLabel(TODAY, -365));
});

/* ---------------- buckets ---------------- */

test('dayList enumerates days and stops on inverted ranges', () => {
  assert.deepEqual(dayList('2026-10-16', '2026-10-18'), ['2026-10-16', '2026-10-17', '2026-10-18']);
  assert.deepEqual(dayList('2026-10-18', '2026-10-16'), []);
});

test('granularityFor switches at 35 and 120 days', () => {
  assert.equal(granularityFor(7), 'day');
  assert.equal(granularityFor(35), 'day');
  assert.equal(granularityFor(36), 'week');
  assert.equal(granularityFor(120), 'week');
  assert.equal(granularityFor(121), 'month');
});

test('makeBuckets day: one bucket per day with a full label', () => {
  const b = makeBuckets('2026-10-16', '2026-10-18', 'day');
  assert.equal(b.length, 3);
  assert.equal(b[0].start, '2026-10-16');
  assert.equal(b[0].end, '2026-10-16');
  assert.equal(b[0].label, '16');
  assert.equal(b[0].full, dayShort('2026-10-16'));
});

test('makeBuckets week: Monday-anchored, clipped to the range', () => {
  const b = makeBuckets('2026-10-14', '2026-10-18', 'week');
  assert.equal(b.length, 1);
  assert.equal(b[0].start, '2026-10-14'); // not pulled back before the range
  assert.equal(b[0].end, '2026-10-18');
});

test('makeBuckets month: calendar months with clipping on the edges', () => {
  const b = makeBuckets('2026-09-20', '2026-11-05', 'month');
  assert.equal(b.length, 3);
  assert.equal(b[0].start, '2026-09-20');
  assert.equal(b[1].start, '2026-10-01');
  assert.equal(b[1].end, '2026-10-31');
  assert.equal(b[2].end, '2026-11-05');
});

test('rangeLabel renders both same-month and cross-year spans', () => {
  assert.equal(rangeLabel('2026-10-12', '2026-10-18'), rangeLabel('2026-10-12', '2026-10-18'));
  assert.ok(rangeLabel('2026-09-01', '2026-10-18').includes('2026'));
});

/* ============================================================
   buildAnalytics — seeded fixture
   ============================================================ */

test('buildAnalytics: week totals, comparisons and deltas over real-shaped records', () => {
  const data = fixture();
  const range = resolveRange('week', 0, TODAY);
  const a = buildAnalytics(data, range, { today: TODAY });

  assert.equal(a.granularity, 'day');
  assert.equal(a.series.length, 7);
  assert.equal(a.prevSeries.length, 7);
  assert.equal(a.hasAnyData, true);

  // current week
  assert.equal(a.totals.done, 6);
  assert.equal(a.totals.due, 8);
  assert.equal(a.totals.completion, 75);
  assert.equal(a.totals.focus, 135);
  assert.equal(a.totals.sessions, 2);
  assert.equal(a.totals.avgSession, Math.round(135 / 2));
  assert.equal(a.totals.activeDays, 2);
  // planned = blocks (120 + 60 + 60) + unblocked scheduled task h2 (60); m1 is
  // covered by its linked block so its scheduled time is NOT double-counted.
  assert.equal(a.totals.planned, 300);

  // previous week
  assert.equal(a.prev.done, 2);
  assert.equal(a.prev.due, 3);
  assert.equal(a.prev.focus, 60);
  assert.equal(a.prev.planned, 120);
  assert.equal(a.prev.completion, 67);

  assert.equal(a.deltas.done.abs, 4);
  assert.equal(a.deltas.done.pct, 200);
  assert.equal(a.deltas.focus.abs, 75);
  assert.equal(a.deltas.focus.pct, 125);
  assert.equal(a.deltas.completion.abs, 8);
  // Known engine quirk (documented, corrected in the view via activeDaysIn):
  // totalsFor derives prev.activeDays against the CURRENT period's day maps,
  // so engine prev.activeDays is always 0 and this delta is not a real
  // comparison. The view recomputes the true value with activeDaysIn().
  assert.equal(a.prev.activeDays, 0);
  assert.equal(a.deltas.activeDays.abs, 2); // = current activeDays − 0
  assert.equal(activeDaysIn(data.tasks, data.sessions, range.prevStart, range.prevEnd), 1);

  // bucket-level spot checks (Thu 15 = index 3, Fri 16 = index 4)
  assert.equal(a.series[3].done, 6);
  assert.equal(a.series[3].focus, 90);
  assert.equal(a.series[3].planned, 240);
  assert.equal(a.series[4].done, 0);
  assert.equal(a.series[4].focus, 45);
  assert.equal(a.series[4].planned, 60);
  assert.equal(a.series[0].done, 0);

  assert.equal(a.bestTaskDay.label, '2026-10-15');
  assert.equal(a.bestTaskDay.done, 6);
  assert.equal(a.bestFocusDay.focus, 90);
  assert.equal(a.worstTaskDay.done, 0);
});

test('buildAnalytics: priority breakdown uses only tasks due inside the range', () => {
  const a = buildAnalytics(fixture(), resolveRange('week', 0, TODAY), { today: TODAY });
  assert.deepEqual(
    a.priority.map((p) => [p.name, p.due, p.done, p.open]),
    [
      ['High', 3, 3, 0],
      ['Medium', 3, 2, 1],
      ['Low', 2, 1, 1],
    ]
  );
});

test('buildAnalytics: focus-by-priority matches sessions to linked blocks (and is honest about the rest)', () => {
  const a = buildAnalytics(fixture(), resolveRange('week', 0, TODAY), { today: TODAY });
  assert.equal(a.focusPriority.supported, true);
  assert.deepEqual(a.focusPriority.rows, [
    { name: 'High', minutes: 90 }, // 90-minute session started inside the block linked to a High task
    { name: 'Medium', minutes: 0 },
    { name: 'Low', minutes: 0 },
  ]);
  assert.equal(a.focusPriority.unlinked, 45); // session inside a block with no task link
  assert.equal(a.focusPriority.unmatched, 0);
  assert.equal(a.focusPriority.total, 135);
});

test('buildAnalytics: hour matrix buckets sessions by local weekday and hour', () => {
  const a = buildAnalytics(fixture(), resolveRange('week', 0, TODAY), { today: TODAY });
  const thu = dayIndex('2026-10-15');
  const fri = dayIndex('2026-10-16');
  assert.equal(a.hours.matrix[thu][14], 90);
  assert.equal(a.hours.matrix[fri][9], 45);
  assert.equal(a.hours.totals[14], 90);
  assert.equal(a.hours.totals[9], 45);
  assert.equal(a.hours.peakHour, 14);
});

test('buildAnalytics: calendar window computes runs, gaps and honest no-data days', () => {
  const a = buildAnalytics(fixture(), resolveRange('week', 0, TODAY), { today: TODAY });
  const cal = a.calendar;
  assert.equal(cal.start, '2026-10-12');
  assert.equal(cal.end, '2026-10-18');
  assert.equal(cal.days.length, 7);
  assert.equal(cal.active, 2); // 15th (tasks + focus) and 16th (focus only)
  assert.equal(cal.totalTasks, 6);
  assert.equal(cal.run, 2);
  assert.equal(cal.runStart, '2026-10-15'); // correct here: no later run starts
  assert.equal(cal.gap, 3); // 12th–14th
  // Known engine quirk (documented, corrected in the view): gapStart/runStart
  // remember the MOST RECENT run start, not the longest one — here the short
  // 17th–18th gap overwrites the 12th. longestRun/longestGap re-pair them.
  assert.equal(cal.gapStart, '2026-10-17');
  assert.deepEqual(longestRun(cal.days), { len: 2, start: '2026-10-15' });
  assert.deepEqual(longestGap(cal.days), { len: 3, start: '2026-10-12' });
  assert.equal(cal.max, 6);
  assert.equal(cal.best.label, '2026-10-15');
  assert.equal(cal.truncated, false);
  assert.equal(cal.days.filter((d) => d.noData).length, 0); // fixture starts 10 Sep
  assert.equal(cal.days.find((d) => d.label === '2026-10-16').active, true);
  assert.equal(cal.days.find((d) => d.label === '2026-10-16').tasksDone, 0);
});

test('buildAnalytics: monthly trends cover full history with a month-to-date flag', () => {
  const a = buildAnalytics(fixture(), resolveRange('week', 0, TODAY), { today: TODAY });
  assert.equal(a.months.length, 2);
  assert.equal(a.months[0].tasks, 1);
  assert.equal(a.months[0].focus, 30);
  assert.equal(a.months[0].isMtd, false);
  assert.equal(a.months[1].tasks, 8);
  assert.equal(a.months[1].focus, 195);
  assert.equal(a.months[1].isMtd, true);
});

test('buildAnalytics: goals portfolio reflects current state only', () => {
  const a = buildAnalytics(fixture(), resolveRange('week', 0, TODAY), { today: TODAY });
  assert.equal(a.goals.total, 2);
  assert.equal(a.goals.active, 1);
  assert.equal(a.goals.done, 1);
  assert.equal(a.goals.avgProgress, 40);
  assert.equal(a.goals.nearTarget.length, 0);
  assert.equal(a.goals.rows[0].title, 'Run 10 km');
  assert.equal(a.goals.rows[0].progress, 40);
  assert.equal(a.goals.rows[0].remaining, 6);
});

/* ---------------- ranges over the same fixture ---------------- */

test('buildAnalytics month range compares October-to-date against September', () => {
  const a = buildAnalytics(fixture(), resolveRange('month', 0, TODAY), { today: TODAY });
  assert.equal(a.granularity, 'day');
  // The month-to-date window covers the whole of October so far, including
  // the 7 Oct tasks: 8 done of 11 due.
  assert.equal(a.totals.done, 8);
  assert.equal(a.totals.due, 11);
  assert.equal(a.totals.completion, 73);
  assert.equal(a.prev.done, 1); // s1 on 10 Sep
  assert.equal(a.prev.focus, 30);
  assert.equal(a.deltas.done.abs, 7);
});

test('buildAnalytics mid-week: current series is shorter than the previous week', () => {
  const a = buildAnalytics(fixture(), resolveRange('week', 0, '2026-10-15'), { today: '2026-10-15' });
  assert.equal(a.series.length, 4); // Mon 12 – Thu 15
  assert.equal(a.prevSeries.length, 7); // full previous week
  assert.equal(a.totals.done, 6);
});

test('buildAnalytics all-time: whole history, no previous window, month buckets', () => {
  const range = resolveRange('all', 0, TODAY, '2026-05-01');
  const a = buildAnalytics(fixture(), range, { today: TODAY });
  assert.equal(a.granularity, 'month'); // > 120 days → month buckets
  assert.equal(a.prev, null);
  assert.equal(a.deltas, null);
  assert.equal(a.totals.due, 12);
  assert.equal(a.totals.done, 9);
  assert.equal(a.totals.focus, 225); // 90 + 45 + 60 + 30 (invalid session excluded)
  assert.equal(a.totals.sessions, 4);
  assert.equal(a.months.length, 2);
});

/* ---------------- empty and invalid data ---------------- */

test('buildAnalytics empty: every figure is zero or null — never a fabricated rate', () => {
  const empty = { tasks: [], sessions: [], goals: [], blocks: [] };
  const a = buildAnalytics(empty, resolveRange('week', 0, TODAY), { today: TODAY });
  assert.equal(a.hasAnyData, false);
  assert.equal(a.totals.done, 0);
  assert.equal(a.totals.due, 0);
  assert.equal(a.totals.completion, null); // 0 due → no percentage
  assert.equal(a.totals.focus, 0);
  assert.equal(a.totals.sessions, 0);
  assert.equal(a.totals.avgSession, 0);
  // A bounded range always HAS a previous window, so the engine returns a
  // zeroed totals object (not null); rates stay null — never a fabricated
  // 0% or a −100% change. The view treats this as "no comparison".
  assert.equal(a.prev.done, 0);
  assert.equal(a.prev.completion, null);
  assert.equal(a.deltas.done.abs, 0);
  assert.equal(a.deltas.done.pct, null); // zero baseline → no percentage
  // engine coercion: null − null → 0. The view nulls this field when either
  // rate is missing, so a "0 pp" change is never shown without real rates.
  assert.equal(a.deltas.completion.abs, 0);
  assert.equal(a.months.length, 0);
  assert.deepEqual(a.priority.map((p) => p.due), [0, 0, 0]);
  assert.equal(a.focusPriority.supported, false);
  assert.equal(a.focusPriority.total, 0);
  assert.equal(a.hours.peakHour, null);
  assert.equal(a.calendar.active, 0);
  assert.equal(a.calendar.best, null);
  assert.equal(a.calendar.run, 0);
  assert.equal(a.goals.total, 0);
  assert.equal(a.goals.active, 0);
  assert.equal(a.series.every((b) => b.done === 0 && b.focus === 0 && b.planned === 0), true);
});

test('buildAnalytics survives malformed records without inventing values', () => {
  const data = {
    tasks: [
      { id: 'x', date: '2026-10-15', priority: 'Urgent', status: 'done' }, // unknown priority
      { id: 'y', date: 'garbage', priority: 'High', status: 'done' }, // invalid date
    ],
    sessions: [
      { id: 's1', minutes: 'abc', startedAt: '2026-10-14T10:00:00' }, // invalid minutes, valid day
      { id: 's2', minutes: 30, startedAt: 'nope' }, // invalid timestamp
      { id: 's3', minutes: 20, startedAt: '2026-10-15T07:05:00' },
    ],
    goals: [{ id: 'g', title: 'G', progress: 'weird', target: 0, current: 0, unit: '', done: false }],
    blocks: [{ id: 'b', date: '2026-10-15', startTime: 'bad', endTime: 'worse' }],
  };
  const a = buildAnalytics(data, resolveRange('week', 0, TODAY), { today: TODAY });
  // valid records still count; invalid ones contribute nothing
  assert.equal(a.totals.due, 1);
  assert.equal(a.totals.done, 1);
  assert.equal(a.totals.focus, 20);
  assert.equal(a.totals.sessions, 2); // the 'abc'-minutes session counts as a 0-minute session
  assert.equal(a.totals.avgSession, 10);
  assert.equal(a.totals.planned, 0);
  assert.equal(a.focusPriority.unmatched, 20); // no usable block times
  assert.equal(a.hours.peakHour, 7);
  // Regression fix: a non-numeric goal progress is coerced defensively
  // (treated as 0) instead of leaking NaN through clamp() into rows,
  // averages and comparisons.
  assert.equal(a.goals.rows[0].progress, 0);
  assert.ok(Number.isFinite(a.goals.avgProgress));
  assert.equal(a.goals.nearTarget.length, 0);
});

test('90-day range uses week buckets and still compares against the prior 90 days', () => {
  const a = buildAnalytics(fixture(), resolveRange('90', 0, TODAY), { today: TODAY });
  assert.equal(a.granularity, 'week');
  assert.ok(a.series.length >= 12 && a.series.length <= 14);
  assert.equal(a.prevSeries.length, a.series.length); // equal-length windows
  // The 90-day window contains all October activity plus 7/8 Oct and 10 Sep.
  assert.equal(a.totals.done, 9);
  assert.equal(a.totals.due, 12);
  assert.equal(a.totals.focus, 225); // 135 + 60 (7 Oct) + 30 (10 Sep)
  assert.equal(a.totals.sessions, 4);
  assert.equal(a.prev.done, 0); // nothing in the prior 90 days
  assert.equal(a.deltas.done.pct, null); // zero baseline → no fabricated percentage
  assert.equal(a.calendar.truncated, false); // the window is exactly 90 days
});

/* ---------------- honest-comparison helpers ---------------- */

test('activeDaysIn counts completed-task days and session days in a window', () => {
  const data = fixture();
  assert.equal(activeDaysIn(data.tasks, data.sessions, '2026-10-05', '2026-10-11'), 1); // 7 Oct only
  assert.equal(activeDaysIn(data.tasks, data.sessions, '2026-10-12', '2026-10-18'), 2); // 15th + 16th
  assert.equal(activeDaysIn(data.tasks, data.sessions, '2026-10-17', '2026-10-18'), 0); // quiet window
  assert.equal(activeDaysIn([], [], '2026-10-12', '2026-10-18'), 0);
  // a session alone makes a day active even with no completed tasks
  assert.equal(activeDaysIn([], [{ minutes: 5, startedAt: '2026-10-13T12:00:00' }], '2026-10-12', '2026-10-18'), 1);
});

test('longestRun / longestGap pair the true length with its start day', () => {
  const mk = (label, active, noData = false) => ({ label, active, noData, tasksDone: 0, focus: 0 });
  const days = [
    mk('d1', false), mk('d2', false), mk('d3', true), mk('d4', true), mk('d5', false), mk('d6', true),
  ];
  assert.deepEqual(longestRun(days), { len: 2, start: 'd3' }); // d3�d4, not the later d6
  assert.deepEqual(longestGap(days), { len: 2, start: 'd1' }); // d1�d2, not the later d5
  // pre-history (noData) days are neutral: they neither extend nor break runs
  const nd = [mk('x1', false, true), mk('x2', true), mk('x3', false, true), mk('x4', false)];
  assert.deepEqual(longestRun(nd), { len: 1, start: 'x2' });
  assert.deepEqual(longestGap(nd), { len: 1, start: 'x4' });
  assert.deepEqual(longestRun([]), { len: 0, start: null });
  assert.deepEqual(longestGap([]), { len: 0, start: null });
  // all-active and all-inactive windows
  const allA = [mk('a1', true), mk('a2', true)];
  assert.deepEqual(longestRun(allA), { len: 2, start: 'a1' });
  assert.deepEqual(longestGap(allA), { len: 0, start: null });
  const allI = [mk('i1', false), mk('i2', false), mk('i3', false)];
  assert.deepEqual(longestGap(allI), { len: 3, start: 'i1' });
  assert.deepEqual(longestRun(allI), { len: 0, start: null });
});

/* ============ audit regressions ========== */

test('goalProgress never yields NaN and stays in 0..100', () => {
  assert.equal(goalProgress(42), 42);
  assert.equal(goalProgress('50'), 50, 'numeric strings coerce');
  assert.equal(goalProgress('weird'), 0, 'non-numeric treated as not started');
  assert.equal(goalProgress(null), 0);
  assert.equal(goalProgress(undefined), 0);
  assert.equal(goalProgress(NaN), 0);
  assert.equal(goalProgress(Infinity), 0);
  assert.equal(goalProgress(150), 100, 'clamped above');
  assert.equal(goalProgress(-10), 0, 'clamped below');
  assert.ok(Number.isFinite(goalProgress('weird')), 'never NaN');
});

test('goals with non-numeric target/current degrade to honest zeroed rows', () => {
  const data = fixture();
  data.goals = [
    { id: 'g-bad', title: 'Bad', kind: 'active', progress: 'abc', target: 'x', current: 'y', unit: '', done: false },
  ];
  const a = buildAnalytics(data, resolveRange('week', 0, TODAY), { today: TODAY });
  const row = a.goals.rows[0];
  assert.equal(row.progress, 0);
  assert.equal(row.target, 0);
  assert.equal(row.current, 0);
  assert.equal(row.remaining, null, 'no fabricated remaining value');
  assert.ok(Number.isFinite(a.goals.avgProgress));
});

test('timeToMinutes rejects impossible clock values', () => {
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('23:59'), 23 * 60 + 59);
  assert.equal(timeToMinutes('12:99'), null, 'mm >= 60 rejected');
  assert.equal(timeToMinutes('24:00'), null, 'hh >= 24 rejected');
  assert.equal(timeToMinutes('7:05'), 7 * 60 + 5);
});

test('formatDuration never renders Infinity or NaN', () => {
  assert.equal(formatDuration(Infinity), '0m');
  assert.equal(formatDuration(-Infinity), '0m');
  assert.equal(formatDuration(NaN), '0m');
  assert.equal(formatDuration(90), '1h 30m');
});
