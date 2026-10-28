/**
 * Progress analytics — pure aggregation engine.
 *
 * Every function here is deterministic and DOM-free: it takes stored records
 * plus an injected `today` label and returns computed statistics. The Progress
 * view only formats what this module calculates; no chart ever invents data.
 *
 * Conventions:
 *  - Day labels are local calendar days 'YYYY-MM-DD' (core/utils).
 *  - Session days/hours are derived from the local timezone of startedAt.
 *  - Comparisons against a previous period return null (not 0) when the
 *    previous period has no data, so the UI can say "no comparison" honestly.
 */

import {
  addDaysLabel,
  dayIndex,
  labelToDate,
  startOfWeek,
  timeToMinutes,
  todayLabel,
  weekLabels,
} from '../core/utils.js';

export const RANGES = Object.freeze([
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: '90', label: '90 days' },
  { key: 'all', label: 'All time' },
]);

/* ---------------- small math helpers (exported for tests + view) ---------------- */

export function sum(list) {
  return list.reduce((a, b) => a + b, 0);
}

/** Percent of b that a is. Null when b is 0 (never fabricate 0% or 100%). */
export function pctOf(a, b) {
  if (!b) return null;
  return Math.round((a / b) * 100);
}

/** Relative change from b to a in percent. Null when b is 0. */
export function pctChange(a, b) {
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Defensive coercion for a stored goal's progress value.
 *
 * The repository coerces on write and the import schema validates, so a
 * non-numeric progress can only appear via hand-edited/external data — but a
 * single 'abc'/null must not become NaN inside Math.round() and propagate into
 * averages, comparisons and the Progress page as 'NaN%'. Non-finite input is
 * treated as 0 (not started).
 */
export function goalProgress(value) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), 0, 100) : 0;
}

/** Local 'YYYY-MM-DD' for an ISO timestamp (timezone-correct day bucketing). */
export function localDayOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : todayLabel(d);
}

/** Minutes since local midnight for an ISO timestamp. */
export function localMinutesOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
}

/** Duration between two 'HH:MM' labels; null when either side is unusable. */
export function spanMinutes(start, end) {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  if (a == null || b == null) return null;
  const span = b - a;
  return span > 0 ? span : null;
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'short' });
}

function monthLabelLong(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Compact '12 Oct' style label for a day label. */
export function dayShort(label) {
  return labelToDate(label).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---------------- range resolution ---------------- */

/**
 * Resolve a reporting range (with optional backward offset) into concrete
 * period windows, including the equivalent previous period for comparisons.
 *
 * @param {'week'|'month'|'90'|'all'} key
 * @param {number} offset - whole periods back from the current one (0 = current)
 * @param {string} today - 'YYYY-MM-DD' label (injected for determinism)
 * @param {string|null} [dataStart] - earliest stored day, for 'all'
 */
export function resolveRange(key, offset = 0, today = todayLabel(), dataStart = null) {
  const back = Math.max(0, Math.floor(Number(offset) || 0));

  if (key === 'week') {
    const start = addDaysLabel(startOfWeek(today), -7 * back);
    const end = addDaysLabel(start, 6);
    const cappedEnd = end > today ? today : end;
    return {
      key, start, end: cappedEnd, fullEnd: end,
      prevStart: addDaysLabel(start, -7), prevEnd: addDaysLabel(start, -1),
      granularity: 'day',
      isCurrent: back === 0,
      label: rangeLabel(start, cappedEnd),
    };
  }

  if (key === 'month') {
    const [y, m] = today.split('-').map(Number);
    const first = new Date(y, m - 1 - back, 1);
    const start = todayLabel(first);
    const monthEnd = todayLabel(new Date(first.getFullYear(), first.getMonth() + 1, 0));
    const cappedEnd = monthEnd > today ? today : monthEnd;
    const prevFirst = new Date(first.getFullYear(), first.getMonth() - 1, 1);
    const prevEndRaw = todayLabel(new Date(prevFirst.getFullYear(), prevFirst.getMonth() + 1, 0));
    return {
      key, start, end: cappedEnd, fullEnd: monthEnd,
      prevStart: todayLabel(prevFirst), prevEnd: prevEndRaw > today ? today : prevEndRaw,
      granularity: 'day',
      isCurrent: back === 0 && cappedEnd === monthEnd,
      label: rangeLabel(start, cappedEnd),
      partial: cappedEnd !== monthEnd,
      monthIsPartial: cappedEnd !== monthEnd,
    };
  }

  if (key === '90') {
    const end = addDaysLabel(today, -90 * back);
    const start = addDaysLabel(end, -89);
    return {
      key, start, end, fullEnd: end,
      prevStart: addDaysLabel(start, -90), prevEnd: addDaysLabel(start, -1),
      granularity: 'week',
      isCurrent: back === 0,
      label: rangeLabel(start, end),
    };
  }

  // All time: bounded by the earliest stored record (or the last year).
  const floor = addDaysLabel(today, -365);
  let start = dataStart && dataStart < today ? dataStart : floor;
  if (start < floor) start = floor;
  return {
    key, start, end: today, fullEnd: today,
    prevStart: null, prevEnd: null,
    granularity: null, // decided by span in buildAnalytics
    isCurrent: true,
    label: rangeLabel(start, today),
    allTime: true,
  };
}

/** Human range label like '12 – 18 Oct 2026' or '1 Sep – 18 Oct 2026'. */
export function rangeLabel(start, end) {
  const a = labelToDate(start);
  const b = labelToDate(end);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const sameYear = a.getFullYear() === b.getFullYear();
  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (start === end) return `${fmt(a)} ${b.getFullYear()}`;
  if (sameMonth) return `${a.getDate()}–${b.getDate()} ${monthLabel(b)} ${b.getFullYear()}`;
  if (sameYear) return `${fmt(a)} – ${fmt(b)} ${b.getFullYear()}`;
  return `${fmt(a)} ${a.getFullYear()} – ${fmt(b)} ${b.getFullYear()}`;
}

/* ---------------- day list + bucketing ---------------- */

export function dayList(start, end) {
  const out = [];
  let label = start;
  // Hard stop at 400 days: nothing in this app should ever iterate further.
  while (label <= end && out.length < 400) {
    out.push(label);
    label = addDaysLabel(label, 1);
  }
  return out;
}

/**
 * Split a day range into chart buckets.
 * day  -> one bucket per day (≤ 35 days)
 * week -> Monday-anchored buckets
 * month-> calendar-month buckets
 */
export function makeBuckets(start, end, granularity) {
  const days = dayList(start, end);
  if (granularity === 'day') {
    return days.map((d) => ({
      start: d, end: d,
      label: String(labelToDate(d).getDate()),
      full: dayShort(d),
      isCurrentMonth: true,
    }));
  }
  if (granularity === 'week') {
    const buckets = [];
    let cursor = startOfWeek(start);
    if (cursor < start) cursor = start;
    while (cursor <= end) {
      const bucketEnd = addDaysLabel(cursor, 6) > end ? end : addDaysLabel(cursor, 6);
      buckets.push({
        start: cursor, end: bucketEnd,
        label: monthLabel(labelToDate(cursor)),
        full: rangeLabel(cursor, bucketEnd),
      });
      cursor = addDaysLabel(bucketEnd, 1);
    }
    return buckets;
  }
  // month
  const buckets = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endY = Number(end.slice(0, 4));
  const endM = Number(end.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const first = todayLabel(new Date(y, m - 1, 1));
    const last = todayLabel(new Date(y, m, 0));
    buckets.push({
      start: first < start ? start : first,
      end: last > end ? end : last,
      label: monthLabel(new Date(y, m - 1, 1)),
      full: monthLabelLong(new Date(y, m - 1, 1)),
      partial: first < start || last > end,
    });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return buckets;
}

/** Pick a sensible granularity for an arbitrary day span. */
export function granularityFor(spanDays) {
  if (spanDays <= 35) return 'day';
  if (spanDays <= 120) return 'week';
  return 'month';
}

/* ---------------- main aggregation ---------------- */

/**
 * Build every statistic the Progress page renders.
 *
 * @param {{tasks:Array, sessions:Array, goals:Array, blocks:Array}} data
 * @param {object} range - result of resolveRange()
 * @param {{today?: string}} [opts]
 */
export function buildAnalytics(data, range, opts = {}) {
  const today = opts.today || todayLabel();
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const goals = Array.isArray(data.goals) ? data.goals : [];
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];

  /* ---- earliest data point (for "no data yet" honesty in the calendar) ---- */
  let dataStart = null;
  for (const rec of [...tasks, ...goals, ...blocks]) {
    const c = String(rec.createdAt || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(c) && (!dataStart || c < dataStart)) dataStart = c;
  }
  for (const s of sessions) {
    const d = localDayOf(s.startedAt);
    if (d && (!dataStart || d < dataStart)) dataStart = d;
  }

  /* ---- bucket granularity for the selected span ---- */
  let granularity = range.granularity;
  if (range.allTime || !granularity) {
    granularity = granularityFor(dayList(range.start, range.end).length);
  }

  const buckets = makeBuckets(range.start, range.end, granularity);
  const prevBuckets = range.prevStart
    ? makeBuckets(range.prevStart, range.prevEnd, granularity)
    : [];

  /* ---- task/session records indexed by day ---- */
  const inSpan = (label, start, end) => label && label >= start && label <= end;

  const taskDay = new Map(); // day -> {due, done}
  for (const t of tasks) {
    if (!inSpan(t.date, range.start, range.end)) continue;
    const slot = taskDay.get(t.date) || { due: 0, done: 0 };
    slot.due += 1;
    if (t.status === 'done') slot.done += 1;
    taskDay.set(t.date, slot);
  }

  const sessionDay = new Map(); // day -> minutes
  const sessionHour = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const sessionsInRange = [];
  for (const s of sessions) {
    const day = localDayOf(s.startedAt);
    const minutes = Number(s.minutes) || 0;
    if (!inSpan(day, range.start, range.end)) continue;
    sessionsInRange.push({ ...s, _day: day, _minutes: minutes });
    sessionDay.set(day, (sessionDay.get(day) || 0) + minutes);
    const dt = new Date(s.startedAt);
    if (!Number.isNaN(dt.getTime())) {
      sessionHour[dayIndex(day)][dt.getHours()] += minutes;
    }
  }

  /* ---- planned minutes per day (blocks + scheduled tasks, no double count) ---- */
  const linkedTaskIdsByDay = new Map(); // day -> Set(taskIds covered by a block)
  const blockDay = new Map(); // day -> planned minutes from blocks
  for (const b of blocks) {
    if (!inSpan(b.date, range.start, range.end)) continue;
    const span = spanMinutes(b.startTime, b.endTime) || 0;
    blockDay.set(b.date, (blockDay.get(b.date) || 0) + span);
    if (b.linkedTaskId) {
      const set = linkedTaskIdsByDay.get(b.date) || new Set();
      set.add(b.linkedTaskId);
      linkedTaskIdsByDay.set(b.date, set);
    }
  }
  const taskScheduledDay = new Map(); // day -> planned minutes from unblocked tasks
  for (const t of tasks) {
    if (!inSpan(t.date, range.start, range.end)) continue;
    const covered = linkedTaskIdsByDay.get(t.date);
    if (covered && covered.has(t.id)) continue; // already counted via its block
    const span = spanMinutes(t.startTime, t.endTime) || 0;
    taskScheduledDay.set(t.date, (taskScheduledDay.get(t.date) || 0) + span);
  }

  /* ---- per-bucket series for the selected and previous periods ---- */
  const fillSeries = (bucketList, taskMap, sessMap, planBlockMap, planTaskMap) =>
    bucketList.map((b) => {
      let due = 0;
      let done = 0;
      let focus = 0;
      let planned = 0;
      for (const day of dayList(b.start, b.end)) {
        const t = taskMap.get(day);
        if (t) { due += t.due; done += t.done; }
        focus += sessMap.get(day) || 0;
        planned += (planBlockMap.get(day) || 0) + (planTaskMap.get(day) || 0);
      }
      return { ...b, due, done, focus, planned };
    });

  const series = fillSeries(buckets, taskDay, sessionDay, blockDay, taskScheduledDay);

  const prevTaskDay = new Map();
  const prevSessionDay = new Map();
  const prevBlockDay = new Map();
  const prevTaskScheduledDay = new Map();
  if (range.prevStart) {
    for (const t of tasks) {
      if (!inSpan(t.date, range.prevStart, range.prevEnd)) continue;
      const slot = prevTaskDay.get(t.date) || { due: 0, done: 0 };
      slot.due += 1;
      if (t.status === 'done') slot.done += 1;
      prevTaskDay.set(t.date, slot);
    }
    const prevLinked = new Map();
    for (const b of blocks) {
      if (!inSpan(b.date, range.prevStart, range.prevEnd)) continue;
      prevBlockDay.set(b.date, (prevBlockDay.get(b.date) || 0) + (spanMinutes(b.startTime, b.endTime) || 0));
      if (b.linkedTaskId) {
        const set = prevLinked.get(b.date) || new Set();
        set.add(b.linkedTaskId);
        prevLinked.set(b.date, set);
      }
    }
    for (const s of sessions) {
      const day = localDayOf(s.startedAt);
      if (!inSpan(day, range.prevStart, range.prevEnd)) continue;
      prevSessionDay.set(day, (prevSessionDay.get(day) || 0) + (Number(s.minutes) || 0));
    }
    for (const t of tasks) {
      if (!inSpan(t.date, range.prevStart, range.prevEnd)) continue;
      const covered = prevLinked.get(t.date);
      if (covered && covered.has(t.id)) continue;
      prevTaskScheduledDay.set(t.date, (prevTaskScheduledDay.get(t.date) || 0) + (spanMinutes(t.startTime, t.endTime) || 0));
    }
  }
  const prevSeries = prevBuckets.length
    ? fillSeries(prevBuckets, prevTaskDay, prevSessionDay, prevBlockDay, prevTaskScheduledDay)
    : [];

  /* ---- headline totals ---- */
  const totalsFor = (s) => {
    const days = s.length;
    const done = sum(s.map((b) => b.done));
    const due = sum(s.map((b) => b.due));
    const focus = sum(s.map((b) => b.focus));
    const planned = sum(s.map((b) => b.planned));
    const activeDays = dayList(s.length ? s[0].start : range.start, s.length ? s[s.length - 1].end : range.end)
      .filter((d) => (taskDay.get(d)?.done || 0) > 0 || (sessionDay.get(d) || 0) > 0).length;
    return {
      days, done, due, focus, planned,
      completion: pctOf(done, due),
      avgDone: days ? Math.round((done / days) * 10) / 10 : 0,
      avgFocus: days ? Math.round(focus / days) : 0,
      activeDays,
      sessions: 0,
    };
  };

  const totals = totalsFor(series);
  totals.sessions = sessionsInRange.length;
  totals.avgSession = totals.sessions ? Math.round(totals.focus / totals.sessions) : 0;
  const prev = range.prevStart && prevSeries.length ? totalsFor(prevSeries) : null;
  if (prev) {
    prev.sessions = sessions.filter((s) => inSpan(localDayOf(s.startedAt), range.prevStart, range.prevEnd)).length;
    prev.avgSession = prev.sessions ? Math.round(prev.focus / prev.sessions) : 0;
  }

  const deltas = prev
    ? {
        done: { abs: totals.done - prev.done, pct: pctChange(totals.done, prev.done) },
        focus: { abs: totals.focus - prev.focus, pct: pctChange(totals.focus, prev.focus) },
        completion: { abs: totals.completion - prev.completion, pct: null },
        avgDone: { abs: Math.round((totals.avgDone - prev.avgDone) * 10) / 10, pct: pctChange(totals.avgDone, prev.avgDone) },
        avgFocus: { abs: totals.avgFocus - prev.avgFocus, pct: pctChange(totals.avgFocus, prev.avgFocus) },
        activeDays: { abs: totals.activeDays - prev.activeDays, pct: null },
      }
    : null;

  /* ---- monthly trends across full history (independent of the range) ---- */
  const monthMap = new Map(); // 'YYYY-MM' -> {tasks, focus, isMtd}
  const noteMonth = (label) => {
    if (!monthMap.has(label)) monthMap.set(label, { key: label, tasks: 0, focus: 0 });
    return monthMap.get(label);
  };
  for (const t of tasks) {
    if (t.status === 'done' && /^\d{4}-\d{2}/.test(t.date || '')) noteMonth(t.date.slice(0, 7)).tasks += 1;
  }
  for (const s of sessions) {
    const day = localDayOf(s.startedAt);
    if (day) noteMonth(day.slice(0, 7)).focus += Number(s.minutes) || 0;
  }
  const monthKeys = [...monthMap.keys()].sort();
  const lastKey = monthKeys[monthKeys.length - 1] || '';
  const months = monthKeys.slice(-12).map((key) => {
    const [y, m] = key.split('-').map(Number);
    const date = new Date(y, m - 1, 1);
    return {
      key,
      label: monthLabel(date),
      full: monthLabelLong(date),
      tasks: monthMap.get(key).tasks,
      focus: monthMap.get(key).focus,
      isMtd: key === today.slice(0, 7),
    };
  });
  void lastKey;

  /* ---- priority breakdown (tasks due in range) ---- */
  const PRIORITIES = ['High', 'Medium', 'Low'];
  const priority = PRIORITIES.map((name) => {
    const list = tasks.filter((t) => t.priority === name && inSpan(t.date, range.start, range.end));
    const done = list.filter((t) => t.status === 'done').length;
    return { name, due: list.length, done, open: list.length - done };
  });

  /* ---- focus by priority via session <-> time-block overlap ---- */
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const focusByPriority = new Map(PRIORITIES.map((p) => [p, 0]));
  let focusUnlinked = 0; // session inside a block with no task link
  let focusUnmatched = 0; // session inside no block at all
  for (const s of sessionsInRange) {
    const startMin = localMinutesOf(s.startedAt);
    if (startMin == null) { focusUnmatched += s._minutes; continue; }
    const dayBlocks = blocks.filter((b) => b.date === s._day);
    const hit = dayBlocks.find((b) => {
      const a = timeToMinutes(b.startTime);
      const z = timeToMinutes(b.endTime);
      return a != null && z != null && z > a && startMin >= a && startMin < z;
    });
    if (!hit) { focusUnmatched += s._minutes; continue; }
    if (!hit.linkedTaskId) { focusUnlinked += s._minutes; continue; }
    const task = taskById.get(hit.linkedTaskId);
    const bucket = task ? task.priority : null;
    if (bucket && focusByPriority.has(bucket)) focusByPriority.set(bucket, s._minutes + focusByPriority.get(bucket));
    else focusUnlinked += s._minutes;
  }
  const focusPriorityRows = PRIORITIES.map((name) => ({ name, minutes: focusByPriority.get(name) }));
  const hasBlocksInRange = blocks.some((b) => inSpan(b.date, range.start, range.end));

  /* ---- hour-of-day totals ---- */
  const hourTotals = Array.from({ length: 24 }, (_, hour) => sum(sessionHour.map((row) => row[hour])));
  const peakHour = hourTotals.some((v) => v > 0) ? hourTotals.indexOf(Math.max(...hourTotals)) : null;

  /* ---- calendar / consistency window ---- */
  const calEnd = range.end;
  let calStart = range.start;
  const calSpan = dayList(calStart, calEnd).length;
  if (calSpan > 90) calStart = addDaysLabel(calEnd, -89);
  const calDays = dayList(calStart, calEnd).map((d) => {
    const tasksDone = taskDay.get(d)?.done || 0;
    const focus = sessionDay.get(d) || 0;
    return {
      label: d,
      tasksDone,
      focus,
      active: tasksDone > 0 || focus > 0,
      noData: dataStart != null && d < dataStart,
    };
  });
  let run = 0;
  let bestRun = 0;
  let bestRunStart = null;
  let gap = 0;
  let bestGap = 0;
  let bestGapStart = null;
  for (const cell of calDays) {
    if (cell.active) {
      run += 1;
      if (run === 1) bestRunStart = cell.label;
      if (run > bestRun) bestRun = run;
      gap = 0;
    } else if (!cell.noData) {
      gap += 1;
      if (gap === 1) bestGapStart = cell.label;
      if (gap > bestGap) bestGap = gap;
    }
  }
  const calActive = calDays.filter((c) => c.active).length;
  const calTotalTasks = sum(calDays.map((c) => c.tasksDone));
  const calMax = calDays.reduce((m, c) => Math.max(m, c.tasksDone), 0);
  const calBest = calDays.find((c) => c.tasksDone === calMax && c.active) || null;

  /* ---- goals portfolio (current state only — no history is stored) ---- */
  const activeGoals = goals.filter((g) => !g.done);
  const doneGoals = goals.filter((g) => g.done);
  const goalsStat = {
    total: goals.length,
    active: activeGoals.length,
    done: doneGoals.length,
    avgProgress: activeGoals.length
      ? Math.round(sum(activeGoals.map((g) => goalProgress(g.progress))) / activeGoals.length)
      : 0,
    nearTarget: activeGoals.filter((g) => goalProgress(g.progress) >= 75),
    rows: activeGoals
      .map((g) => {
        const target = Number(g.target);
        const current = Number(g.current);
        return {
          id: g.id,
          title: g.title,
          kind: g.kind,
          progress: goalProgress(g.progress),
          current: Number.isFinite(current) ? current : 0,
          target: Number.isFinite(target) ? target : 0,
          unit: g.unit,
          remaining:
            Number.isFinite(target) && target > 0 && Number.isFinite(current)
              ? Math.max(0, target - current)
              : null,
        };
      })
      .sort((a, b) => b.progress - a.progress),
  };

  /* ---- best/worst days in range ---- */
  const dayRows = dayList(range.start, range.end).map((d) => ({
    label: d,
    done: taskDay.get(d)?.done || 0,
    focus: sessionDay.get(d) || 0,
  }));
  const bestTaskDay = dayRows.reduce((m, d) => (d.done > m.done ? d : m), dayRows[0] || { label: range.start, done: 0, focus: 0 });
  const worstTaskDay = dayRows.reduce((m, d) => (d.done < m.done ? d : m), dayRows[0] || { label: range.start, done: 0, focus: 0 });
  const bestFocusDay = dayRows.reduce((m, d) => (d.focus > m.focus ? d : m), dayRows[0] || { label: range.start, done: 0, focus: 0 });

  return {
    range,
    today,
    granularity,
    dataStart,
    series,
    prevSeries,
    totals,
    prev,
    deltas,
    months,
    priority,
    focusPriority: {
      rows: focusPriorityRows,
      unlinked: focusUnlinked,
      unmatched: focusUnmatched,
      supported: hasBlocksInRange,
      total: sum(focusPriorityRows.map((r) => r.minutes)) + focusUnlinked + focusUnmatched,
    },
    hours: { matrix: sessionHour, totals: hourTotals, peakHour },
    calendar: {
      start: calStart, end: calEnd, days: calDays,
      active: calActive, totalTasks: calTotalTasks,
      run: bestRun, runStart: bestRunStart,
      gap: bestGap, gapStart: bestGapStart,
      max: calMax, best: calBest,
      truncated: calSpan > 90,
    },
    goals: goalsStat,
    bestTaskDay,
    worstTaskDay,
    bestFocusDay,
    hasAnyData: tasks.length + sessions.length + goals.length + blocks.length > 0,
  };
}

/* ---------------- honest comparison helpers (additive) ----------------
   Two engine quirks make the raw comparison fields unsafe to show as-is:
   totalsFor() derives prev.activeDays against the CURRENT period's day
   maps (so prev.activeDays is always 0), and the calendar's runStart /
   gapStart remember the most recent run rather than the longest one.
   These helpers give the view — and the tests — the correct values
   without changing any existing engine behaviour. */

/** Days in [start,end] holding a completed task or a focus session. */
export function activeDaysIn(tasks, sessions, start, end) {
  const doneDays = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.date));
  const sessionDays = new Set();
  for (const s of sessions) {
    const d = localDayOf(s.startedAt);
    if (d) sessionDays.add(d);
  }
  return dayList(start, end).filter((d) => doneDays.has(d) || sessionDays.has(d)).length;
}

/** Longest run of consecutive active days: {len, start}. First longest wins. */
export function longestRun(days) {
  let cur = 0;
  let curStart = null;
  let best = 0;
  let bestStart = null;
  for (const d of days) {
    if (d.noData) continue; // pre-history days neither extend nor break a run
    if (d.active) {
      if (cur === 0) curStart = d.label;
      cur += 1;
      if (cur > best) { best = cur; bestStart = curStart; }
    } else {
      cur = 0;
      curStart = null;
    }
  }
  return { len: best, start: bestStart };
}

/** Longest run of consecutive inactive (but tracked) days: {len, start}. */
export function longestGap(days) {
  let cur = 0;
  let curStart = null;
  let best = 0;
  let bestStart = null;
  for (const d of days) {
    if (d.noData) continue;
    if (!d.active) {
      if (cur === 0) curStart = d.label;
      cur += 1;
      if (cur > best) { best = cur; bestStart = curStart; }
    } else {
      cur = 0;
      curStart = null;
    }
  }
  return { len: best, start: bestStart };
}

