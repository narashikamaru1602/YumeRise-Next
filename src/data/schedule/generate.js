/**
 * Daily schedule generator — pure functions, no I/O.
 * Builds paired task + timetable block records for one local calendar day.
 */

import { uid, timeToMinutes, minutesToTime } from '../../core/utils.js';
import { ACTIVITY, defaultOptionsForDate } from './defaults.js';

/**
 * @typedef {object} ScheduleItem
 * @property {string} key
 * @property {string} title
 * @property {string} description
 * @property {string} startTime
 * @property {string} endTime
 * @property {'Low'|'Medium'|'High'} priority
 * @property {string} [taskId]
 * @property {string} [blockId]
 */

/**
 * @typedef {object} GeneratedSchedule
 * @property {string} date
 * @property {object} options
 * @property {ScheduleItem[]} items
 * @property {object[]} tasks
 * @property {object[]} blocks
 * @property {string[]} notes
 */

function clampRange(startMin, durationMin, dayEndMin) {
  const start = Math.max(0, startMin);
  const end = Math.min(dayEndMin, start + Math.max(1, durationMin));
  if (end <= start) return null;
  return { start, end };
}

/**
 * Greedy place: find the earliest slot at or after `from` that fits `duration`
 * without overlapping existing occupied ranges. Returns null if none before dayEnd.
 * @param {{start:number,end:number}[]} occupied
 */
function placeAfter(occupied, from, duration, dayEnd) {
  let cursor = Math.max(0, from);
  const sorted = occupied.slice().sort((a, b) => a.start - b.start);
  while (cursor + duration <= dayEnd) {
    const conflict = sorted.find((r) => cursor < r.end && cursor + duration > r.start);
    if (!conflict) {
      return { start: cursor, end: cursor + duration };
    }
    cursor = Math.max(cursor, conflict.end);
  }
  return null;
}

function pushItem(items, occupied, spec) {
  const range = clampRange(spec.startMin, spec.durationMin, spec.dayEnd ?? 24 * 60);
  if (!range) return false;
  // If forced start overlaps, shift forward.
  let start = range.start;
  let end = range.end;
  const duration = end - start;
  const conflict = occupied.some((r) => start < r.end && end > r.start);
  if (conflict) {
    const placed = placeAfter(occupied, start, duration, spec.dayEnd ?? 24 * 60);
    if (!placed) return false;
    start = placed.start;
    end = placed.end;
  }
  occupied.push({ start, end });
  items.push({
    key: spec.key,
    title: spec.title,
    description: spec.description || '',
    startTime: minutesToTime(start),
    endTime: minutesToTime(end),
    priority: spec.priority || 'Medium',
  });
  return true;
}

/**
 * Generate a proposed daily schedule.
 * @param {Partial<ReturnType<typeof defaultOptionsForDate>>} options
 * @returns {GeneratedSchedule}
 */
export function generateDailySchedule(options = {}) {
  const base = defaultOptionsForDate(options.date || defaultOptionsForDate(new Date().toISOString().slice(0, 10)).date);
  const opts = { ...base, ...options, date: options.date || base.date };
  const notes = [];
  const items = [];
  const occupied = [];
  const dayEnd = timeToMinutes(opts.sleepTarget) ?? 23 * 60;
  const sleepMin = dayEnd;

  const schoolStart = timeToMinutes(opts.schoolStart) ?? 7 * 60;
  const schoolEnd = timeToMinutes(opts.schoolEnd) ?? 15 * 60;
  const coachStart = timeToMinutes(opts.coachingStart) ?? 17 * 60;
  const coachEnd = timeToMinutes(opts.coachingEnd) ?? 20 * 60;

  if (opts.hasSchool) {
    notes.push('School day: school block scheduled.');
  } else {
    notes.push('No school on this day — study blocks stay flexible.');
  }
  if (opts.hasCoaching) {
    notes.push('Coaching included.');
  } else {
    notes.push('Coaching omitted for this day.');
  }

  // Morning
  pushItem(items, occupied, {
    key: ACTIVITY.wake.id,
    title: ACTIVITY.wake.label,
    description: ACTIVITY.wake.description,
    startMin: schoolStart - (ACTIVITY.wake.defaultMinutes + ACTIVITY.breakfast.defaultMinutes),
    durationMin: ACTIVITY.wake.defaultMinutes,
    priority: ACTIVITY.wake.priority,
    dayEnd: sleepMin,
  });
  pushItem(items, occupied, {
    key: ACTIVITY.breakfast.id,
    title: ACTIVITY.breakfast.label,
    description: ACTIVITY.breakfast.description,
    startMin: schoolStart - ACTIVITY.breakfast.defaultMinutes,
    durationMin: ACTIVITY.breakfast.defaultMinutes,
    priority: ACTIVITY.breakfast.priority,
    dayEnd: sleepMin,
  });

  if (opts.hasSchool) {
    pushItem(items, occupied, {
      key: ACTIVITY.school.id,
      title: ACTIVITY.school.label,
      description: ACTIVITY.school.description,
      startMin: schoolStart,
      durationMin: Math.max(30, schoolEnd - schoolStart),
      priority: ACTIVITY.school.priority,
      dayEnd: sleepMin,
    });
    pushItem(items, occupied, {
      key: ACTIVITY.travelHome.id,
      title: ACTIVITY.travelHome.label,
      description: ACTIVITY.travelHome.description,
      startMin: schoolEnd,
      durationMin: ACTIVITY.travelHome.defaultMinutes,
      priority: ACTIVITY.travelHome.priority,
      dayEnd: sleepMin,
    });
  } else {
    // Weekend / holiday lunch mid-day
    pushItem(items, occupied, {
      key: ACTIVITY.lunch.id,
      title: ACTIVITY.lunch.label,
      description: ACTIVITY.lunch.description,
      startMin: 12 * 60 + 30,
      durationMin: ACTIVITY.lunch.defaultMinutes,
      priority: ACTIVITY.lunch.priority,
      dayEnd: sleepMin,
    });
  }

  // Homework after school or mid-afternoon on free days
  const homeworkFrom = opts.hasSchool ? schoolEnd + ACTIVITY.travelHome.defaultMinutes : 10 * 60;
  pushItem(items, occupied, {
    key: ACTIVITY.homework.id,
    title: ACTIVITY.homework.label,
    description: ACTIVITY.homework.description,
    startMin: homeworkFrom,
    durationMin: opts.hasSchool ? ACTIVITY.homework.defaultMinutes : 90,
    priority: ACTIVITY.homework.priority,
    dayEnd: sleepMin,
  });

  pushItem(items, occupied, {
    key: ACTIVITY.snack.id,
    title: ACTIVITY.snack.label,
    description: ACTIVITY.snack.description,
    startMin: homeworkFrom + (opts.hasSchool ? ACTIVITY.homework.defaultMinutes : 90),
    durationMin: ACTIVITY.snack.defaultMinutes,
    priority: ACTIVITY.snack.priority,
    dayEnd: sleepMin,
  });

  if (opts.hasCoaching) {
    pushItem(items, occupied, {
      key: ACTIVITY.coaching.id,
      title: ACTIVITY.coaching.label,
      description: ACTIVITY.coaching.description,
      startMin: coachStart,
      durationMin: Math.max(30, coachEnd - coachStart),
      priority: ACTIVITY.coaching.priority,
      dayEnd: sleepMin,
    });
  }

  // Dinner after coaching or early evening
  const dinnerFrom = opts.hasCoaching ? coachEnd : 18 * 60 + 30;
  pushItem(items, occupied, {
    key: ACTIVITY.dinner.id,
    title: ACTIVITY.dinner.label,
    description: ACTIVITY.dinner.description,
    startMin: dinnerFrom,
    durationMin: ACTIVITY.dinner.defaultMinutes,
    priority: ACTIVITY.dinner.priority,
    dayEnd: sleepMin,
  });

  // Evening practices — place greedily after dinner
  const eveningQueue = [];
  if (opts.includeStrength) eveningQueue.push(ACTIVITY.strength);
  if (opts.includeVolleyball) eveningQueue.push(ACTIVITY.volleyball);
  if (opts.includePython) eveningQueue.push(ACTIVITY.python);
  if (opts.includeJapanese) eveningQueue.push(ACTIVITY.japanese);
  if (opts.includeYumerise) eveningQueue.push(ACTIVITY.yumerise);
  if (opts.includeMinecraft) eveningQueue.push(ACTIVITY.minecraft);

  let cursor = dinnerFrom + ACTIVITY.dinner.defaultMinutes;
  for (const act of eveningQueue) {
    const placed = placeAfter(occupied, cursor, act.defaultMinutes, sleepMin - ACTIVITY.windDown.defaultMinutes);
    if (!placed) {
      notes.push(`Could not fit “${act.label}” before sleep target — skipped.`);
      continue;
    }
    occupied.push(placed);
    items.push({
      key: act.id,
      title: act.label,
      description: act.description,
      startTime: minutesToTime(placed.start),
      endTime: minutesToTime(placed.end),
      priority: act.priority,
    });
    cursor = placed.end;
  }

  // Wind down ending at sleep target when possible
  const windDur = ACTIVITY.windDown.defaultMinutes;
  const windStart = Math.max(cursor, sleepMin - windDur);
  if (windStart + windDur <= 24 * 60) {
    const conflict = occupied.some((r) => windStart < r.end && windStart + windDur > r.start);
    if (!conflict) {
      occupied.push({ start: windStart, end: windStart + windDur });
      items.push({
        key: ACTIVITY.windDown.id,
        title: ACTIVITY.windDown.label,
        description: ACTIVITY.windDown.description,
        startTime: minutesToTime(windStart),
        endTime: minutesToTime(windStart + windDur),
        priority: ACTIVITY.windDown.priority,
      });
    } else {
      const placed = placeAfter(occupied, cursor, windDur, 24 * 60);
      if (placed) {
        occupied.push(placed);
        items.push({
          key: ACTIVITY.windDown.id,
          title: ACTIVITY.windDown.label,
          description: ACTIVITY.windDown.description,
          startTime: minutesToTime(placed.start),
          endTime: minutesToTime(placed.end),
          priority: ACTIVITY.windDown.priority,
        });
        if (placed.end > sleepMin) {
          notes.push('Wind-down runs past the sleep target — consider shortening evening activities.');
        }
      }
    }
  }

  // Sort chronologically
  items.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));

  // Materialize task + block pairs with stable linked IDs
  const now = new Date().toISOString();
  const tasks = [];
  const blocks = [];
  for (const item of items) {
    const taskId = uid();
    const blockId = uid();
    item.taskId = taskId;
    item.blockId = blockId;
    tasks.push({
      id: taskId,
      title: item.title,
      description: item.description || '',
      date: opts.date,
      startTime: item.startTime,
      endTime: item.endTime,
      priority: item.priority,
      status: 'todo',
      checklist: [],
      createdAt: now,
      updatedAt: now,
    });
    blocks.push({
      id: blockId,
      title: item.title,
      date: opts.date,
      startTime: item.startTime,
      endTime: item.endTime,
      linkedTaskId: taskId,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { date: opts.date, options: opts, items, tasks, blocks, notes };
}

/**
 * Rebuild tasks/blocks arrays from edited items (preserves ids when present).
 * @param {string} date
 * @param {ScheduleItem[]} items
 */
export function materializeFromItems(date, items) {
  const now = new Date().toISOString();
  const tasks = [];
  const blocks = [];
  const sorted = items.slice().sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
  for (const item of sorted) {
    const taskId = item.taskId || uid();
    const blockId = item.blockId || uid();
    item.taskId = taskId;
    item.blockId = blockId;
    tasks.push({
      id: taskId,
      title: String(item.title || '').trim() || 'Untitled',
      description: String(item.description || '').trim(),
      date,
      startTime: item.startTime || '',
      endTime: item.endTime || '',
      priority: ['Low', 'Medium', 'High'].includes(item.priority) ? item.priority : 'Medium',
      status: 'todo',
      checklist: [],
      createdAt: now,
      updatedAt: now,
    });
    blocks.push({
      id: blockId,
      title: String(item.title || '').trim() || 'Untitled',
      date,
      startTime: item.startTime || '09:00',
      endTime: item.endTime || '',
      linkedTaskId: taskId,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { tasks, blocks };
}
