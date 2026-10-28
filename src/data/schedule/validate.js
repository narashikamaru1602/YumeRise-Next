/**
 * Validate a proposed daily schedule before save or JSON export.
 */

import { isDateLabel, isTimeLabel } from '../import/schema.js';
import { timeToMinutes } from '../../core/utils.js';

/**
 * @param {{ date: string, tasks: object[], blocks: object[] }} schedule
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateSchedule(schedule) {
  const errors = [];
  if (!schedule || typeof schedule !== 'object') {
    return { ok: false, errors: ['Schedule is missing.'] };
  }
  if (!isDateLabel(schedule.date)) {
    errors.push('Date must be a real calendar day (YYYY-MM-DD).');
  }
  const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : [];
  const blocks = Array.isArray(schedule.blocks) ? schedule.blocks : [];

  if (tasks.length === 0 && blocks.length === 0) {
    errors.push('Schedule has no items to save.');
  }

  const taskIds = new Set();
  for (const [i, task] of tasks.entries()) {
    const label = `Task ${i + 1}`;
    if (!task?.id || typeof task.id !== 'string') errors.push(`${label}: missing id.`);
    else if (taskIds.has(task.id)) errors.push(`${label}: duplicate id ${task.id}.`);
    else taskIds.add(task.id);
    if (!task?.title || !String(task.title).trim()) errors.push(`${label}: title is required.`);
    if (task?.date && !isDateLabel(task.date)) errors.push(`${label}: invalid date.`);
    if (task?.date && schedule.date && task.date !== schedule.date) {
      errors.push(`${label}: date must match schedule day ${schedule.date}.`);
    }
    if (task?.startTime != null && !isTimeLabel(task.startTime)) errors.push(`${label}: invalid start time.`);
    if (task?.endTime != null && !isTimeLabel(task.endTime)) errors.push(`${label}: invalid end time.`);
    if (task?.startTime && task?.endTime) {
      const a = timeToMinutes(task.startTime);
      const b = timeToMinutes(task.endTime);
      if (a != null && b != null && b <= a) errors.push(`${label}: end time must be after start time.`);
    }
    if (task?.priority && !['Low', 'Medium', 'High'].includes(task.priority)) {
      errors.push(`${label}: priority must be Low, Medium, or High.`);
    }
    if (task?.status && !['todo', 'done'].includes(task.status)) {
      errors.push(`${label}: status must be todo or done.`);
    }
  }

  const blockIds = new Set();
  const ranges = [];
  for (const [i, block] of blocks.entries()) {
    const label = `Block ${i + 1}`;
    if (!block?.id || typeof block.id !== 'string') errors.push(`${label}: missing id.`);
    else if (blockIds.has(block.id)) errors.push(`${label}: duplicate id ${block.id}.`);
    else blockIds.add(block.id);
    if (!block?.title || !String(block.title).trim()) errors.push(`${label}: title is required.`);
    if (block?.date && !isDateLabel(block.date)) errors.push(`${label}: invalid date.`);
    if (block?.date && schedule.date && block.date !== schedule.date) {
      errors.push(`${label}: date must match schedule day ${schedule.date}.`);
    }
    if (!isTimeLabel(block?.startTime ?? '')) errors.push(`${label}: invalid start time.`);
    if (block?.endTime != null && !isTimeLabel(block.endTime)) errors.push(`${label}: invalid end time.`);
    if (block?.linkedTaskId) {
      if (!taskIds.has(block.linkedTaskId)) {
        errors.push(`${label}: linkedTaskId does not match any task in this schedule.`);
      }
    }
    const a = timeToMinutes(block.startTime);
    const b = timeToMinutes(block.endTime || '');
    if (a != null && b != null && b <= a) errors.push(`${label}: end time must be after start time.`);
    if (a != null && b != null && b > a) ranges.push({ i, start: a, end: b, title: block.title });
  }

  ranges.sort((x, y) => x.start - y.start);
  for (let i = 1; i < ranges.length; i += 1) {
    const prev = ranges[i - 1];
    const cur = ranges[i];
    if (cur.start < prev.end) {
      errors.push(
        `Overlapping blocks: “${prev.title}” (${minutesLabel(prev.start)}–${minutesLabel(prev.end)}) and “${cur.title}” (${minutesLabel(cur.start)}–${minutesLabel(cur.end)}).`
      );
    }
  }

  // Cross-set: every task should have a matching block by linkedTaskId (soft warning as error for planner integrity)
  for (const task of tasks) {
    if (!blocks.some((b) => b.linkedTaskId === task.id)) {
      errors.push(`Task “${task.title}” has no linked timetable block.`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

function minutesLabel(m) {
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
